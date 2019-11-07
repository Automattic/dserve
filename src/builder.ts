import * as fs from 'fs-extra';
import * as git from 'nodegit';
import * as os from 'os';
import * as path from 'path';
import * as tar from 'tar-fs';
import { Readable } from 'stream';

import {
	CommitHash,
	getImageName,
	docker,
	BranchName,
	refreshLocalImages,
	refreshRemoteBranches,
	getCommitHashForBranch,
} from './api';
import { config } from './config';
import { closeLogger, l, getLoggerForBuild } from './logger';
import { ONE_SECOND, ONE_MINUTE, FIVE_MINUTES } from './constants';
import { increment, timing, gauge } from './stats';

// hidden method in nodegit that turns on thread safety
// see https://github.com/nodegit/nodegit/pull/836
( git as any ).enableThreadSafety();

export const MAX_CONCURRENT_BUILDS = 2;
export const SINGLE_BUILD_CONCURRENCY = Math.max(
	1,
	Math.floor( os.cpus().length / MAX_CONCURRENT_BUILDS )
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
	l.log( `removing directory: ${ buildDir }` );
	pendingHashes.delete( hash );
	return fs.remove( buildDir );
}

const waitingOnCommits: Set< CommitHash > = new Set();
async function waitForCommit( commitHash: CommitHash ): Promise< boolean > {
	let repo = await git.Repository.open( path.join( __dirname, '..', 'repos', 'wp-calypso' ) );
	try {
		await repo.getCommit( commitHash );
		return true;
	} catch {
		// commit not found, refresh
		await refreshRemoteBranches();
		try {
			await repo.getCommit( commitHash );
			return true;
		} catch {
			return false;
		}
	} finally {
		repo.free();
	}
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
	l.log(
		{ buildQueueSize: buildQueue.length, commitHash },
		'Adding a commitHash to the buildQueue'
	);
	increment( 'build.queued' );
	failedHashes.delete( commitHash );
	buildQueue.push( commitHash );
	gauge( 'build_queue', buildQueue.length );
}

export async function buildImageForHash( commitHash: CommitHash ): Promise< void > {
	let buildStream: NodeJS.ReadableStream;

	const buildDir = getBuildDir( commitHash );
	const repoDir = path.join( buildDir, 'repo' );
	const pathToLog = getLogPath( commitHash );
	const imageName = getImageName( commitHash );
	let imageStart: number;

	if ( await isBuildInProgress( commitHash ) ) {
		l.log( { commitHash, buildDir }, 'Skipping build because a build is already in progress' );
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

	try {
		l.log( { commitHash, buildDir, repoDir, imageName }, 'Attempting to build image.' );

		const cloneStart = Date.now();
		buildLogger.info( 'Cloning git repo' );
		const calypsoDir = path.join( __dirname, '../repos', 'wp-calypso' );
		const repo = await git.Clone.clone( calypsoDir, repoDir );
		buildLogger.info( 'Finished cloning repo' );
		const cloneTime = Date.now() - cloneStart;
		timing( 'git.build.clone', cloneTime );
		l.log( { commitHash, cloneTime }, 'Finished cloning repo' );

		const checkoutStart = Date.now();
		const commit = await repo.getCommit( commitHash );
		const branch = await repo.createBranch( 'dserve', commit, true );
		await repo.checkoutBranch( branch );
		repo.free();
		const checkoutTime = Date.now() - checkoutStart;
		timing( 'git.build.checkout', checkoutTime );
		l.log( { commitHash, checkoutTime }, 'Checked out branch' );
		buildLogger.info( 'Checked out the correct branch' );

		buildLogger.info( 'Placing all the contents into a tarball stream for docker\n' );
		l.log(
			{ commitHash, repoDir, imageName },
			'Placing contents of repoDir into a tarball and sending to docker for a build'
		);
		const tarStream = tar.pack( repoDir );
		buildLogger.info( 'Handing off tarball to Docker for the rest of the legwork\n' );

		imageStart = Date.now();
		buildStream = await docker.buildImage( tarStream, {
			t: imageName,
			nocache: false,
			forcerm: true,
			buildargs: {
				commit_sha: commitHash,
				workers: String( SINGLE_BUILD_CONCURRENCY ),
			},
		} );
	} catch ( err ) {
		buildLogger.error(
			{ err },
			`Encountered error while git checking out, tarballing, or handing to docker`
		);
		l.error(
			{ err },
			`Encountered error while git checking out, tarballing, or handing to docker`
		);
		increment( 'build.error' );
		pendingHashes.delete( commitHash );
		failedHashes.add( commitHash );
	}

	if ( ! buildStream ) {
		l.error( { buildStream }, "Failed to build image but didn't throw an error" );
		increment( 'build.error' );
		pendingHashes.delete( commitHash );
		failedHashes.add( commitHash );
		closeLogger( buildLogger as any );
		return;
	}

	async function onFinished( err: Error ) {
		if ( ! err ) {
			const buildImageTime = Date.now() - imageStart;
			timing( 'build_image', buildImageTime );
			increment( 'build.success' );
			try {
				await refreshLocalImages();
			} catch ( err ) {
				l.log( { commitHash, err }, 'Error refreshing local images' );
			}
			l.log(
				{ commitHash, buildImageTime, repoDir, imageName },
				`Successfully built image. Now cleaning up build directory`
			);
			cleanupBuildDir( commitHash );
		} else {
			increment( 'build.error' );
			buildLogger.error( { err }, 'Encountered error when building image' );
			l.error( { err, commitHash }, `Failed to build image for. Leaving build files in place` );
			failedHashes.add( commitHash );
		}
		pendingHashes.delete( commitHash );
		closeLogger( buildLogger as any );
	}

	function onProgress( event: any ) {
		if ( event.stream ) {
			buildLogger.info( { fromDocker: true }, event.stream );
		} else {
			buildLogger.info( { fromDocker: true }, event );
		}
	}

	docker.modem.followProgress( buildStream, onFinished, onProgress );
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
		l.log(
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
			l.log( { commitHash }, 'Popping a commitHash off of the buildQueue' );
			buildImageForHash( commitHash );
		} );
	if ( buildQueue.length !== currentLength ) {
		gauge( 'build_queue', buildQueue.length );
	}
}

function reportQueueDepth() {
	gauge( 'build_queue', buildQueue.length );
}

loop( warnOnQueueBuildup, ONE_MINUTE );
loop( buildFromQueue, ONE_SECOND );

// report the queue depth every five seconds to keep statsd aggregations happy
loop( reportQueueDepth, ONE_SECOND * 5 );
