import fs from 'fs-extra';
import os from 'os';
import { spawn } from 'child_process';
import path from 'path';
import { sample } from 'lodash';

import { CommitHash, getImageName, refreshLocalImages, refreshRemoteBranches } from './api';
import { config } from './config';
import { closeLogger, l, getLoggerForBuild } from './logger';
import { ONE_SECOND, ONE_MINUTE } from './constants';
import { increment, timing, gauge } from './stats';
import { checkoutCommit, cloneRepo, hasCommit } from './git';

export const MAX_CONCURRENT_BUILDS = 4;

const MAX_CORES = [ 12 ];
export const getBuildConcurrency = () =>
	Math.max(
		1,
		Math.min( Math.floor( os.cpus().length / MAX_CONCURRENT_BUILDS ), sample( MAX_CORES ) )
	);

export const buildQueue: Array< CommitHash > = [];
export const pendingHashes: Set< CommitHash > = new Set();
const failedHashes: Set< CommitHash > = new Set();

export const getLogPath = ( hash: CommitHash ) =>
	path.join( getBuildDir( hash ), config.build.logFilename );
export async function isBuildInProgress( hash: CommitHash ): Promise< boolean > {
	if ( pendingHashes.has( hash ) ) {
		return true;
	}

	const pathExists = await fs.pathExists( getBuildDir( hash ) );

	return pendingHashes.has( hash ) || pathExists;
}

export function didBuildFail( hash: CommitHash ): boolean {
	return failedHashes.has( hash );
}

export async function readBuildLog( hash: CommitHash ): Promise< string | null > {
	return ( await fs.pathExists( getLogPath( hash ) ) )
		? fs.readFile( getLogPath( hash ), 'utf-8' )
		: null;
}

export function getBuildDir( hash: CommitHash ) {
	const tmpDir = os.tmpdir();
	return path.join( tmpDir, `dserve-build-${ config.repo.project.replace( '/', '-' ) }-${ hash }` );
}

export async function cleanupBuildDir( hash: CommitHash ) {
	const buildDir = getBuildDir( hash );
	l.info( `removing directory: ${ buildDir }` );
	pendingHashes.delete( hash );
	return fs.remove( buildDir );
}

const waitingOnCommits: Set< CommitHash > = new Set();
async function waitForCommit( commitHash: CommitHash ): Promise< boolean > {
	const repoDir = path.join( __dirname, '..', 'repos', 'wp-calypso' );
	if ( await hasCommit( repoDir, commitHash ) ) {
		return true;
	}

	await refreshRemoteBranches();
	return hasCommit( repoDir, commitHash );
}

export async function addToBuildQueue( commitHash: CommitHash ) {
	if ( waitingOnCommits.has( commitHash ) ) {
		return;
	}
	waitingOnCommits.add( commitHash );
	try {
		const foundCommit = await waitForCommit( commitHash );
		if ( ! foundCommit ) {
			l.error( { commitHash }, 'Cannot find commit' );
			return;
		}
	} finally {
		waitingOnCommits.delete( commitHash );
	}

	if ( buildQueue.includes( commitHash ) || pendingHashes.has( commitHash ) ) {
		return;
	}
	l.info(
		{ buildQueueSize: buildQueue.length, commitHash },
		'Adding a commitHash to the buildQueue'
	);
	increment( 'build.queued' );
	failedHashes.delete( commitHash );
	buildQueue.push( commitHash );
	gauge( 'build_queue', buildQueue.length );
}

function pipeLines( stream: NodeJS.ReadableStream | null, onLine: ( line: string ) => void ) {
	if ( ! stream ) return;

	stream.setEncoding( 'utf8' );
	let buf = '';

	stream.on( 'data', chunk => {
		buf += chunk;
		let nl = buf.indexOf( '\n' );

		while ( nl !== -1 ) {
			const line = buf.slice( 0, nl ).replace( /\r$/, '' );
			buf = buf.slice( nl + 1 );
			if ( line ) onLine( line );
			nl = buf.indexOf( '\n' );
		}
	} );

	stream.on( 'end', () => {
		const line = buf.replace( /\r$/, '' );
		if ( line ) onLine( line );
	} );
}

async function buildWithDockerCli( {
	repoDir,
	imageName,
	commitHash,
	buildConcurrency,
	buildLogger,
	buildDir,
}: {
	repoDir: string;
	imageName: string;
	commitHash: string;
	buildConcurrency: number;
	buildLogger: any;
	buildDir: string;
} ) {
	const iidFile = path.join( buildDir, 'image.iid' );

	const args = [
		'build',
		'--progress=plain',
		'--iidfile',
		iidFile,
		'-t',
		imageName,
		'--force-rm',
		'--build-arg',
		`commit_sha=${ commitHash }`,
		'--build-arg',
		`workers=${ buildConcurrency }`,
		'.',
	];

	await new Promise< void >( ( resolve, reject ) => {
		const child = spawn( 'docker', args, {
			cwd: repoDir,
			env: {
				...process.env,
				DOCKER_BUILDKIT: '1',
				BUILDKIT_PROGRESS: 'plain',
			},
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		} );

		child.on( 'error', reject );

		pipeLines( child.stdout, line => {
			buildLogger.info( { fromDockerCli: true, stream: 'stdout' }, line );
		} );

		pipeLines( child.stderr, line => {
			buildLogger.info( { fromDockerCli: true, stream: 'stderr' }, line );
		} );

		child.on( 'close', code => {
			if ( code === 0 ) {
				resolve();
			} else {
				reject( new Error( `docker build exited with code ${ code }` ) );
			}
		} );
	} );
}

export async function buildImageForHash( commitHash: CommitHash ): Promise< void > {
	const buildDir = getBuildDir( commitHash );
	const repoDir = path.join( buildDir, 'repo' );
	const imageName = getImageName( commitHash );
	let imageStart: number;
	let shouldCleanup = false;

	if ( await isBuildInProgress( commitHash ) ) {
		l.info( { commitHash, buildDir }, 'Skipping build because a build is already in progress' );
		return;
	}

	pendingHashes.add( commitHash );
	failedHashes.delete( commitHash );

	increment( 'build.start' );

	try {
		await fs.mkdir( buildDir );
	} catch ( err ) {
		l.error( { err, buildDir, commitHash }, 'Could not create directory for the build' );
		increment( 'build.error' );
		pendingHashes.delete( commitHash );
		failedHashes.add( commitHash );
		return;
	}
	const buildLogger = getLoggerForBuild( commitHash );
	const buildConcurrency = getBuildConcurrency();

	try {
		l.info(
			{ commitHash, buildDir, repoDir, imageName, buildConcurrency },
			'Attempting to build image.'
		);

		const cloneStart = Date.now();
		buildLogger.info( 'Cloning git repo' );
		const calypsoDir = path.join( __dirname, '../repos', 'wp-calypso' );
		await cloneRepo( calypsoDir, repoDir );
		buildLogger.info( 'Finished cloning repo' );
		const cloneTime = Date.now() - cloneStart;
		timing( 'git.build.clone', cloneTime );
		l.info( { commitHash, cloneTime }, 'Finished cloning repo' );

		const checkoutStart = Date.now();
		await checkoutCommit( repoDir, commitHash );
		const checkoutTime = Date.now() - checkoutStart;
		timing( 'git.build.checkout', checkoutTime );
		l.info( { commitHash, checkoutTime }, 'Checked out branch' );
		buildLogger.info( 'Checked out the correct branch' );

		buildLogger.info( 'Handing repo directory to docker CLI for the rest of the legwork\n' );
		l.info(
			{ commitHash, repoDir, imageName, buildConcurrency },
			'Building repoDir through docker CLI'
		);

		imageStart = Date.now();
		await buildWithDockerCli( {
			repoDir,
			imageName,
			commitHash,
			buildConcurrency,
			buildLogger,
			buildDir,
		} );

		const buildImageTime = Date.now() - imageStart;
		timing( 'build_image', buildImageTime );
		timing( `build_image_by_core.${ buildConcurrency }_cores`, buildImageTime );

		try {
			await refreshLocalImages();
		} catch ( err ) {
			l.info( { commitHash, err }, 'Error refreshing local images' );
		}

		increment( 'build.success' );
		shouldCleanup = true;

		l.info(
			{ commitHash, buildImageTime, repoDir, imageName, buildConcurrency },
			'Successfully built image. Now cleaning up build directory'
		);
	} catch ( err ) {
		increment( 'build.error' );
		buildLogger.error( { err }, 'Encountered error while building image' );
		l.error( { err, commitHash }, 'Failed to build image for. Leaving build files in place' );
		failedHashes.add( commitHash );
		return;
	} finally {
		pendingHashes.delete( commitHash );
		closeLogger( buildLogger as any );

		if ( shouldCleanup ) {
			try {
				await cleanupBuildDir( commitHash );
			} catch ( err ) {
				l.warn( { err, commitHash, buildDir }, 'Failed to clean up build directory' );
			}
		}
	}
}

// Background tasks

const loop = ( f: Function, delay: number ) => {
	const run = () => {
		f();
		//console.log( 'running loop with %o and %d', f, delay );
		setTimeout( run, delay );
	};

	run();
};

function warnOnQueueBuildup() {
	if ( buildQueue.length > MAX_CONCURRENT_BUILDS ) {
		l.info(
			{ buildQueue },
			'There are images waiting to be built that are stuck because of too many concurrent builds'
		);
	}
}
export function buildFromQueue() {
	const currentLength = buildQueue.length;
	buildQueue
		.splice( 0, MAX_CONCURRENT_BUILDS - pendingHashes.size ) // grab the next batch of builds
		.forEach( commitHash => {
			l.info( { commitHash }, 'Popping a commitHash off of the buildQueue' );
			buildImageForHash( commitHash );
		} );
	if ( buildQueue.length !== currentLength ) {
		gauge( 'build_queue', buildQueue.length );
	}
}

function reportQueueDepth() {
	gauge( 'build_queue', buildQueue.length );
}

if ( process.env.NODE_ENV !== 'test' ) {
	loop( warnOnQueueBuildup, ONE_MINUTE );
	loop( buildFromQueue, ONE_SECOND );

	// report the queue depth every five seconds to keep statsd aggregations happy
	loop( reportQueueDepth, ONE_SECOND * 5 );
}
