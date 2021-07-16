import httpProxy from 'http-proxy';
import Docker, { ImageInfo } from 'dockerode';
import _ from 'lodash';
import getPort from 'get-port';
import git from 'nodegit';
import fs from 'fs-extra';
import path from 'path';
import { promisify } from 'util';
import { ContainerInfo } from 'dockerode';

import { config, envContainerConfig } from './config';
import { l } from './logger';
import { pendingHashes } from './builder';
import { exec } from 'child_process';

import { CONTAINER_EXPIRY_TIME } from './constants';
import { timing } from './stats';

type APIState = {
	accesses: Map< ContainerName, number >;
	branchHashes: Map< CommitHash, BranchName >;
	containers: Map< string, Docker.ContainerInfo >;
	localImages: Map< ImageName, Docker.ImageInfo >;
	pullingImages: Map< ImageName, Promise< DockerodeStream > >;
	remoteBranches: Map< BranchName, CommitHash >;
	startingContainers: Map< CommitHash, Promise< ContainerInfo > >;
};

export const state: APIState = {
	accesses: new Map(),
	branchHashes: new Map(),
	containers: new Map(),
	localImages: new Map(),
	pullingImages: new Map(),
	remoteBranches: new Map(),
	startingContainers: new Map(),
};

export const docker = new Docker();

// types
export type NotFound = Error;
export type CommitHash = string;
export type BranchName = string;
export type PortNumber = number;
export type ImageStatus = 'NoImage' | 'Inactive' | PortNumber;
export type RunEnv = string;
export type DockerRepository = string;
export type ImageName = string;
export type ContainerName = string;
export type DockerodeStream = any;
export type ContainerSearchOptions = {
	image?: ImageName;
	env?: RunEnv;
	status?: string;
	id?: string;
	name?: string;
	sanitizedName?: string;
};

export const getImageName = ( hash: CommitHash ) => `${ config.build.tagPrefix }:${ hash }`;
export const extractCommitFromImage = ( imageName: string ): CommitHash => {
	const [ prefix, sha ] = imageName.split( ':' );
	if ( prefix !== config.build.tagPrefix ) {
		return null;
	}
	return sha;
};

export const extractEnvironmentFromImage = ( image: ContainerInfo ): RunEnv => {
	return image.Labels.calypsoEnvironment || undefined;
};

/**
 * Polls the local Docker daemon to fetch an updated list of images
 *
 * It saves them in the Map `stcate.localImages`, indexed by tag name. If an image has more than
 * one tag it will appear multiple times in the map.
 */
export async function refreshLocalImages() {
	const images = await docker.listImages();
	state.localImages = new Map(
		images.reduce(
			( acc, image ) => [
				...acc,
				...( image.RepoTags || [] ).map( tag => [ tag, image ] as [ ImageName, ImageInfo ] ),
			],
			[]
		)
	);
}

/**
 * Returns the list of images built by dserve
 */
export function getLocalImages() {
	return new Map(
		Array.from( state.localImages.entries() ).filter( ( [ imageName ] ) =>
			imageName.startsWith( config.build.tagPrefix )
		)
	);
}

/**
 * Returns the list of all images
 */
export function getAllImages() {
	return state.localImages;
}

export function getAllContainers() {
	return state.containers;
}

export function isValidImage( imageInfo: ImageInfo ) {
	if ( ! imageInfo.Labels ) return false;

	for ( const [ label, value ] of Object.entries( config.allowedLabels ) ) {
		if ( imageInfo.Labels[ label ] !== value ) return false;
	}
	return true;
}

export async function hasHashLocally( hash: CommitHash ): Promise< boolean > {
	return getLocalImages().has( getImageName( hash ) );
}

export async function deleteImage( hash: CommitHash ) {
	l.log( { commitHash: hash }, 'attempting to remove image for hash' );

	const runningContainer = state.containers.get( getImageName( hash ) );
	if ( runningContainer ) {
		await docker.getContainer( runningContainer.Id ).stop();
	}

	let img;
	try {
		img = docker.getImage( getImageName( hash ) );
		if ( ! img ) {
			l.log(
				{ commitHash: hash },
				'did not have an image locally with name' + getImageName( hash )
			);
			return;
		}
	} catch ( err ) {
		l.log(
			{ commitHash: hash, err },
			'error trying to find image locally with name' + getImageName( hash )
		);
		return;
	}

	try {
		await img.remove( { force: true } );
		l.log( { commitHash: hash }, 'succesfully removed image' );
	} catch ( err ) {
		l.error( { err, commitHash: hash }, 'failed to remove image' );
	}
}
export async function startContainer( commitHash: CommitHash, env: RunEnv ) {
	//l.log( { commitHash }, `Request to start a container for ${ commitHash }` );
	const image = getImageName( commitHash );
	const containerId = `${ env }:${ image }`;

	// do we have an existing container?
	const existingContainer = getRunningContainerForHash( commitHash, env );
	if ( existingContainer ) {
		l.log(
			{ commitHash, containerId: existingContainer.Id },
			`Found a running container for ${ commitHash }`
		);
		return Promise.resolve( existingContainer );
	}

	// are we starting one already?
	if ( state.startingContainers.has( containerId ) ) {
		//l.log( { commitHash }, `Already starting a container for ${ commitHash }` );
		return state.startingContainers.get( containerId );
	}

	async function start(
		image: string,
		commitHash: CommitHash,
		env: RunEnv
	): Promise< ContainerInfo > {
		// ok, try to start one
		let freePort: number;
		try {
			freePort = await getPort();
		} catch ( err ) {
			l.error(
				{ err, image, commitHash },
				`Error while attempting to find a free port for ${ image }`
			);
			throw err;
		}

		const exposedPort = `${ config.build.exposedPort }/tcp`;
		const dockerPromise = new Promise( ( resolve, reject ) => {
			let runError: any;

			l.log( { image, commitHash }, `Starting a container for ${ commitHash }` );

			docker.run(
				image,
				[],
				process.stdout,
				{
					...config.build.containerCreateOptions,
					...envContainerConfig( env ),
					ExposedPorts: { [ exposedPort ]: {} },
					PortBindings: { [ exposedPort ]: [ { HostPort: freePort.toString() } ] },
					Tty: false,
					Labels: {
						calypsoEnvironment: env,
					},
				},
				err => {
					runError = err;
				}
			);

			// run will never callback for calypso when things work as intended.
			// wait 5 seconds. If we don't see an error by then, assume run worked and resolve
			setTimeout( () => {
				if ( runError ) {
					reject( { error: runError, freePort } );
				} else {
					resolve( { freePort } );
				}
			}, 5000 );
		} );
		return dockerPromise.then(
			( { success, freePort } ) => {
				l.log(
					{ image, freePort, commitHash },
					`Successfully started container for ${ image } on ${ freePort }`
				);
				return refreshContainers().then( () => getRunningContainerForHash( commitHash ) );
			},
			( { error, freePort } ) => {
				l.error(
					{ image, freePort, error, commitHash },
					`Failed starting container for ${ image } on ${ freePort }`
				);
				throw error;
			}
		);
	}

	const startPromise = start( image, commitHash, env );

	state.startingContainers.set( containerId, startPromise );
	startPromise.then(
		s => {
			state.startingContainers.delete( containerId );
			return s;
		},
		err => {
			state.startingContainers.delete( containerId );
			throw err;
		}
	);
	return startPromise;
}

export async function refreshContainers() {
	const containers = await docker.listContainers( { all: true } );
	state.containers = new Map(
		containers.map( container => [ container.Id, container ] as [ string, ContainerInfo ] )
	);
}

export function getRunningContainerForHash( hash: CommitHash, env?: RunEnv ): ContainerInfo | null {
	const image = getImageName( hash );
	return Array.from( state.containers.values() ).find(
		ci =>
			ci.Image === image &&
			ci.State === 'running' &&
			( ! env || env === extractEnvironmentFromImage( ci ) )
	);
}

export function isContainerRunning( hash: CommitHash, env?: RunEnv ): boolean {
	return !! getRunningContainerForHash( hash, env );
}

export function getPortForContainer( hash: CommitHash, env: RunEnv ): number | boolean {
	const container = getRunningContainerForHash( hash, env );

	if ( ! container ) {
		return false;
	}

	const ports = container.Ports;

	return ports.length > 0 ? ports[ 0 ].PublicPort : false;
}

async function getRemoteBranches(): Promise< Map< string, string > > {
	const repoDir = path.join( __dirname, '../repos' );
	const calypsoDir = path.join( repoDir, 'wp-calypso' );
	let repo: git.Repository;

	const start = Date.now();

	try {
		if ( ! ( await fs.pathExists( repoDir ) ) ) {
			await fs.mkdir( repoDir );
		}
		if ( ! ( await fs.pathExists( calypsoDir ) ) ) {
			repo = await git.Clone.clone( `https://github.com/${ config.repo.project }`, calypsoDir );
		} else {
			repo = await git.Repository.open( calypsoDir );
		}

		// this code here is all for retrieving origin
		// and then pruning out old branches
		const origin: git.Remote = await repo.getRemote( 'origin' );
		await origin.connect( git.Enums.DIRECTION.FETCH, {} );
		await origin.download( null );
		const pruneError = origin.prune( new git.RemoteCallbacks() );
		if ( pruneError ) {
			throw new Error( `invoking remote prune returned error code: ${ pruneError }` );
		}
		//
		await repo.fetchAll();
	} catch ( err ) {
		l.error( { err }, 'Could not fetch repo to update branches list' );
	}

	if ( ! repo ) {
		l.error( 'Something went very wrong while trying to refresh branches' );
	}

	timing( 'git.refresh', Date.now() - start );

	try {
		const branchesReferences = ( await repo.getReferences() ).filter(
			( x: git.Reference ) => x.isBranch
		);

		const branchToCommitHashMap: Map< string, string > = new Map(
			branchesReferences.map( reference => {
				const name = reference.shorthand().replace( 'origin/', '' );
				const commitHash = reference.target().tostrS();

				return [ name, commitHash ] as [ string, CommitHash ];
			} )
		);

		// gc the repo if no builds are running
		if ( pendingHashes.size === 0 ) {
			try {
				await promisify( exec )( 'git gc', {
					cwd: calypsoDir,
				} );
			} catch ( err ) {
				l.error( { err }, 'git gc failed' );
			}
		}

		return branchToCommitHashMap;
	} catch ( err ) {
		l.error(
			{ err, repository: config.repo.project },
			'Error creating branchName --> commitSha map'
		);
		return;
	}
}

let refreshingPromise: Promise< any > = null;
export async function refreshRemoteBranches() {
	if ( refreshingPromise ) {
		return refreshingPromise;
	}

	refreshingPromise = ( async () => {
		const branches = await getRemoteBranches();

		if ( branches ) {
			state.branchHashes = new Map(
				Array.from( branches ).map( ( [ a, b ] ) => [ b, a ] as [ CommitHash, BranchName ] )
			);

			state.remoteBranches = branches;
		}
	} )();

	function letItGo() {
		refreshingPromise = null;
	}

	refreshingPromise.then( letItGo, letItGo ); // errors never bothered me anyway

	return refreshingPromise;
}

export function getBranchHashes() {
	return state.branchHashes;
}

export function getKnownBranches() {
	return state.remoteBranches;
}

export function getCommitHashForBranch( branch: BranchName ): CommitHash | undefined {
	return state.remoteBranches.get( branch );
}

export function touchCommit( hash: CommitHash, env?: RunEnv ) {
	const container = getRunningContainerForHash( hash, env );
	if ( ! container ) throw `Running container for commit ${ hash } not found}`;

	const name = getContainerName( container );
	touchContainer( name );
}

export function touchContainer( name: ContainerName ) {
	state.accesses.set( name, Date.now() );
}

export function getContainerAccessTime( name: ContainerName ): number | undefined {
	return state.accesses.get( name );
}

/*
 * Get all currently running containers that have expired.
 * Expired means have not been accessed in EXPIRED_DURATION
 */
export function getExpiredContainers() {
	// Filter off containers that are still valid
	return Array.from( state.containers.values() ).filter( ( container: ContainerInfo ) => {
		if ( container.State === 'dead' || container.State === 'created' ) {
			// ignore dead and just created containers
			return false;
		}

		if ( container.State === 'exited' ) {
			// these are done, remove 'em
			return true;
		}

		const createdAgo = Date.now() - container.Created * 1000;
		const lastAccessed = getContainerAccessTime( getContainerName( container ) );

		return (
			createdAgo > CONTAINER_EXPIRY_TIME &&
			( _.isUndefined( lastAccessed ) || Date.now() - lastAccessed > CONTAINER_EXPIRY_TIME )
		);
	} );
}

// stop any container that hasn't been accessed within ten minutes
export async function cleanupExpiredContainers() {
	await refreshContainers();
	const expiredContainers = getExpiredContainers();
	for ( let container of expiredContainers ) {
		const imageName: string = container.Image;

		l.log(
			{
				imageName,
				containerId: container.Id,
			},
			'Cleaning up stale container'
		);

		if ( container.State === 'running' ) {
			try {
				await docker.getContainer( container.Id ).stop();
				l.log( { containerId: container.Id, imageName }, `Successfully stopped container` );
			} catch ( err ) {
				l.error( { err, imageName, containerId: container.Id }, 'Failed to stop container' );
			}
		}
		try {
			await docker.getContainer( container.Id ).remove();
			l.log( { containerId: container.Id, imageName }, `Successfully removed container` );
		} catch ( err ) {
			l.error( { err, imageName, containerId: container.Id }, 'Failed to remove container' );
		}
	}
	refreshContainers();
}

const proxy = httpProxy.createProxyServer( {} ); // See (†)
export async function proxyRequestToHash( req: any, res: any ) {
	const { commitHash, runEnv } = req.session;
	let port = await getPortForContainer( commitHash, runEnv );

	if ( ! port ) {
		l.log( { port, commitHash, runEnv }, `Could not find port for commitHash` );
		res.send( 'Error setting up port!' );
		res.end();
		return;
	}

	touchCommit( commitHash, runEnv );
	proxy.web( req, res, { target: `http://localhost:${ port }` }, err => {
		if ( err && ( err as any ).code === 'ECONNRESET' ) {
			return;
		}
		l.log( { err, req, res, commitHash }, 'unexpected error occured while proxying' );
	} );
}

export function getContainerName( container: ContainerInfo ) {
	// The first character is a `/`, skip it
	return container.Names[ 0 ].substring( 1 );
}

export function findContainer( {
	id,
	image,
	env,
	status,
	name,
	sanitizedName,
}: ContainerSearchOptions ) {
	return Array.from( state.containers.values() ).find( container => {
		if ( image && ( container.Image !== image && container.ImageID !== image ) ) return false;
		if ( env && container.Labels[ 'calypsoEnvironment' ] !== env ) return false;
		if ( status && container.Status !== status ) return false;
		if ( id && container.Id !== id ) return false;
		// In the Docker internal list, names start with `/`
		if ( name && ! container.Names.includes( '/' + name ) ) return false;

		// Sanitized name is the URL friendly version of the container's name (`_` got replaced with `-`)
		if (
			sanitizedName &&
			! container.Names.map( name => name.replace( /_/g, '-' ).substr( 1 ) ).includes(
				sanitizedName
			)
		) {
			return false;
		}

		return true;
	} );
}

export async function proxyRequestToContainer( req: any, res: any, container: ContainerInfo ) {
	// In the Docker internal list, names start with `/`
	const containerName = getContainerName( container );

	if ( ! container.Ports[ 0 ] ) {
		l.log( { containerName }, `Could not find port for container` );
		throw new Error( `Could not find port for container ${ containerName }` );
	}
	const port = container.Ports[ 0 ].PublicPort;

	let retryCounter = config.proxyRetry;
	const proxyToContainer = () =>
		proxy.web( req, res, { target: `http://localhost:${ port }` }, errorHandler );
	const errorHandler = ( err: any ) => {
		if ( err && ( err as any ).code === 'ECONNRESET' ) {
			retryCounter--;
			if ( retryCounter > 0 ) setTimeout( proxyToContainer, 1000 );
		}
		l.log( { err, req, res, containerName }, 'unexpected error occured while proxying' );
		throw new Error( 'unexpected error occured while proxying' );
	};
	touchContainer( containerName );
	proxyToContainer();
}

/**
 * Pulls an image. Calls onProgress() when there is an update, resolves the returned promise
 * when the image is pulled
 */
export async function pullImage( imageName: ImageName, onProgress: ( data: any ) => void ):Promise<void> {
	// Store the stream in memory, so other requets can "join" and listen for the progress
	if ( ! state.pullingImages.has( imageName ) ) {
		const stream = docker.pull( imageName, {} ) as Promise< DockerodeStream >;
		state.pullingImages.set( imageName, stream );
	}

	const stream = state.pullingImages.get( imageName );
	return new Promise( async ( resolve, reject ) => {
		try {
			docker.modem.followProgress(
				await stream,
				( err: any ) => {
					state.pullingImages.delete( imageName );
					if ( err ) reject( err );
					else resolve();
				},
				onProgress
			);
		} catch( err ) {
			reject(err);
		}
	} );
}

/**
 * Asks a container nicely to stop, waits for 10 seconds and then obliterates it
 */
export async function deleteContainer( containerInfo: ContainerInfo ) {
	const container = docker.getContainer( containerInfo.Id );
	if ( containerInfo.State === 'running' ) {
		await container.stop( { t: 10 } );
	}
	await container.remove( { force: true } );
	await refreshContainers();
}

/**
 * Creates a container
 *
 * createContainer is async, but we don't keep a list of container being creates to ensure atomicity for a few reasons:
 *
 * - Creating container is quite fast (a few ms), so the chances of collisions are quite low
 * - Even if we get two requests with the same image+env at the same time, creating two separate containers for the same
 *   image is ok. Each one will get a different URL, and if one of them is not used it will get eventually cleaned up.
 */
export async function createContainer( imageName: ImageName, env: RunEnv ) {
	const exposedPort = `${ config.build.exposedPort }/tcp`;

	let freePort: number;
	try {
		freePort = await getPort();
	} catch ( err ) {
		throw new Error(`Error while attempting to find a free port for ${ imageName }`);
	}

	try {
		const container = await docker.createContainer( {
			...config.build.containerCreateOptions,
			...envContainerConfig( env ),
			Image: imageName,
			ExposedPorts: { [ exposedPort ]: {} },
			HostConfig: {
				PortBindings: { [ exposedPort ]: [ { HostPort: freePort.toString() } ] },
			},
			Labels: {
				calypsoEnvironment: env,
			},
		} );
		l.log( { imageName }, `Successfully created container for ${ imageName }` );
		await refreshContainers();

		// Returns a ContainerInfo for the created container, in order to avoid exposing a real Container object.
		return findContainer( {
			id: container.id,
		} );
	} catch ( error ) {
		error.message = `Failed creating container for ${ imageName }: ${error.message}`;
		throw error;
	}
}

/**
 * Starts a container that was dormant (either never started, or stopped)
 */
export async function reviveContainer( containerInfo: ContainerInfo ) {
	const containerName = getContainerName( containerInfo );

	try {
		// Wait for it if the container is alerady starting
		if (containerInfo.State === "restarting") {
			// Refresh container info until it is not 'restarting' anymore with a throttle of 1s
			while ( containerInfo.State==="restarting" ) {
				await new Promise((resolve) => setTimeout(resolve, 1000))
				await refreshContainers();
				containerInfo = findContainer( {id: containerInfo.Id});
			}
			return containerInfo;
		}

		const container = docker.getContainer( containerInfo.Id );
		await container.start();
		l.log( { containerName }, `Successfully started container` );
		await refreshContainers();

		// This returns the same containerInfo object, but updated
		return findContainer( { id: container.id } );
	} catch ( error ) {
		error.message = `Failed reviving ${containerInfo.State} container  ${ containerName }: ${error.message}`;
		throw error;
	}
}
