import * as httpProxy from 'http-proxy';
import * as Docker from 'dockerode';
import fetch from 'node-fetch';
import * as _ from 'lodash';
import * as portfinder from 'portfinder';
import * as git from 'nodegit';
import * as os from 'os';
import * as fs from 'fs-extra';
import * as path from 'path';
import { promisify } from 'util';
import { WriteStream } from 'fs-extra';
import { Packbuilder } from 'nodegit/pack-builder';
import { Readable } from 'stream';
import { Container, ContainerInfo } from 'dockerode';

import { config } from './config';
import { l, getLoggerForBuild, closeLogger } from './logger';
import { getBuildDir } from './builder';
import { setInterval } from 'timers';
import { stat } from 'fs';

type APIState = {
	accesses: Map<CommitHash, number>;
	branchHashes: Map<CommitHash, BranchName>;
	containers: Map<string, Docker.ContainerInfo>;
	localImages: Map<string, Docker.ImageInfo>;
	remoteBranches: Map<BranchName, CommitHash>;
	startingContainers: Map<CommitHash, Promise<ContainerInfo>>;
};

export const state: APIState = {
	accesses: new Map(),
	branchHashes: new Map(),
	containers: new Map(),
	localImages: new Map(),
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

export const ONE_SECOND = 1000;
export const ONE_MINUTE = 60 * ONE_SECOND;
export const FIVE_MINUTES = 5 * ONE_MINUTE;
export const TEN_MINUTES = 10 * ONE_MINUTE;
export const CONTAINER_EXPIRY_TIME = FIVE_MINUTES;

export const getImageName = (hash: CommitHash) => `${config.build.tagPrefix}:${hash}`;
export const extractCommitFromImage = (imageName: string): CommitHash => imageName.split(':')[1];

/**
 * Polls the local Docker daemon to
 * fetch an updated list of images
 */
export async function refreshLocalImages() {
	const images = await docker.listImages();
	const isTag = (tag: string) => tag.startsWith( config.build.tagPrefix );
	const hasTag = (image: Docker.ImageInfo) => image.RepoTags && image.RepoTags.some( isTag );

	state.localImages = new Map( images.filter( hasTag ).map(
		image => [ image.RepoTags.find( isTag ), image ] as [ string, Docker.ImageInfo ]
	) );
}

/**
 * Returns the list of local images
 */
export function getLocalImages() {
	return state.localImages;
}

export async function hasHashLocally(hash: CommitHash): Promise<boolean> {
	return state.localImages.has( getImageName( hash ) );
}

export async function deleteImage(hash: CommitHash) {
	l.log({ commitHash: hash }, 'attempting to remove image for hash');

	const runningContainer = state.containers.get( getImageName(hash) );
	if (runningContainer) {
		await docker.getContainer(runningContainer.Id).stop();
	}

	const img = docker.getImage(getImageName(hash));
	if (!img) {
		l.log({ commitHash: hash }, 'did not have an image locally with name' + getImageName(hash));
		return;
	}

	try {
		await img.remove({ force: true });
		l.log({ commitHash: hash }, 'succesfully removed image');
	} catch (err) {
		l.error({ err, commitHash: hash }, 'failed to remove image');
	}
}
export async function startContainer(commitHash: CommitHash) {
	l.log({ commitHash }, `Request to start a container for ${commitHash}`);
	const image = getImageName(commitHash);

	// do we have an existing container?
	const existingContainer = getRunningContainerForHash( commitHash );
	if ( existingContainer ) {
		l.log( { commitHash, containerId: existingContainer.Id }, `Found a running container for ${commitHash}`);
		return Promise.resolve( existingContainer );
	}

	// are we starting one already?
	if( state.startingContainers.has( commitHash ) ) {
		l.log( { commitHash }, `Already starting a container for ${commitHash}`)
		return state.startingContainers.get( commitHash );
	}

	async function start( image: string, commitHash: CommitHash ): Promise<ContainerInfo> {
		// ok, try to start one
		let freePort: number;
		try {
			freePort = await portfinder.getPortPromise();
		} catch( err ) {
			l.error( { err, image, commitHash }, `Error while attempting to find a free port for ${image}`);
			throw err;
		}

		const exposedPort = `${config.build.exposedPort}/tcp`;
		const dockerPromise = new Promise( ( resolve, reject ) => {
			let runError: any;

			l.log( { image, commitHash }, `Starting a container for ${commitHash}` );

			docker.run(
				image,
				[],
				process.stdout,
				{
					...config.build.containerCreateOptions,
					ExposedPorts: { [exposedPort]: {} },
					PortBindings: { [exposedPort]: [{ HostPort: freePort.toString() }] },
					Tty: false,
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
		} )
		return dockerPromise.then(
			( { success, freePort } ) => {
				l.log({ image, freePort, commitHash }, `Successfully started container for ${image} on ${freePort}`);
				return refreshRunningContainers().then( () => getRunningContainerForHash( commitHash ) );
			},
			( { error, freePort } ) => {
				l.error({ image, freePort, error, commitHash }, `Failed starting container for ${image} on ${freePort}`);
				throw error;
			}
		);
	};

	const startPromise = start( image, commitHash );

	state.startingContainers.set( commitHash, startPromise );
	startPromise.then(
		s => {
			state.startingContainers.delete( commitHash );
			return s;
		},
		err => {
			state.startingContainers.delete( commitHash );
			throw err;
		}
	)
	return startPromise;
}

export async function refreshRunningContainers() {
	const containers = await docker.listContainers();
	state.containers = new Map( containers.map(
		container => [ container.Id, container ] as [ string, ContainerInfo ]
	) );
}

export function getRunningContainerForHash( hash: CommitHash ) : ContainerInfo | null {
	const image = getImageName(hash);
	return Array.from(state.containers.values()).find( ci => ci.Image === image && ci.State === 'running' );
}

export function isContainerRunning(hash: CommitHash): boolean {
	return !!getRunningContainerForHash( hash );
}

export function getPortForContainer(hash: CommitHash): number|boolean {
	const container = getRunningContainerForHash( hash );

	if ( ! container ) {
		return false;
	}

	const ports = container.Ports;

	return ports.length > 0
		? ports[0].PublicPort
		: false;
}

async function getRemoteBranches(): Promise<Map<string, string>> {
	const repoDir = path.join(__dirname, '../repos');
	const calypsoDir = path.join(repoDir, 'wp-calypso');
	let repo: git.Repository;

	const start = Date.now();

	try {
		if (!await fs.pathExists(repoDir)) {
			await fs.mkdir(repoDir);
		}
		if (!await fs.pathExists(calypsoDir)) {
			repo = await git.Clone.clone(`https://github.com/${config.repo.project}`, calypsoDir);
		} else {
			repo = await git.Repository.open(calypsoDir);
		}

		// this code here is all for retrieving origin
		// and then pruning out old branches
		const origin: git.Remote = await repo.getRemote('origin');
		await origin.connect(git.Enums.DIRECTION.FETCH, {});
		await origin.download(null);
		const pruneError = origin.prune(new git.RemoteCallbacks());
		if (pruneError) {
			throw new Error(`invoking remote prune returned error code: ${pruneError}`);
		}
		//
		await repo.fetchAll();
	} catch (err) {
		l.error({ err }, 'Could not fetch repo to update branches list');
	}

	if (!repo) {
		l.error('Something went very wrong while trying to refresh branches');
	}

	try {
		const branchesReferences = (await repo.getReferences(git.Reference.TYPE.OID)).filter(
			(x: git.Reference) => x.isBranch
		);

		const branchToCommitHashMap: Map<string, string> = new Map( branchesReferences.map(reference => {
			const name = reference.shorthand().replace('origin/', '');
			const commitHash = reference.target().tostrS();

			return [ name, commitHash ] as [ string, CommitHash ];
		} ) );

		repo.free();
		return branchToCommitHashMap;
	} catch (err) {
		l.error({ err, repository: config.repo.project }, 'Error creating branchName --> commitSha map');
		return;
	}
}

let refreshingPromise: Promise<any> = null;
export async function refreshRemoteBranches() {
	if (refreshingPromise) {
		return refreshingPromise;
	}

	refreshingPromise = (async () => {
		const branches = await getRemoteBranches();

		if (branches) {
			state.branchHashes = new Map(
				Array.from(branches).map(([a, b]) => [b, a] as [CommitHash, BranchName])
			);

			state.remoteBranches = branches;
		}
	})();

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

export function touchCommit( hash: CommitHash ) {
	state.accesses.set( hash, Date.now() );
}

export function getCommitAccessTime( hash: CommitHash ): number | undefined {
	return state.accesses.get( hash );
}

/*
 * Get all currently running containers that were created by dserve and have expired.
 * Expired means have not been accessed in EXPIRED_DURATION
 */
export function getExpiredContainers(containers: Array<ContainerInfo>, getAccessTime: Function) {
	return containers.filter((container: ContainerInfo) => {
		const imageName: string = container.Image;

		// exclude container if it wasnt created by this app
		if (!imageName.startsWith(config.build.tagPrefix)) {
			return;
		}

		const createdAgo = Date.now() - ( container.Created * 1000 );
		const lastAccessed = getAccessTime(extractCommitFromImage(imageName));

		return createdAgo > CONTAINER_EXPIRY_TIME &&
			( _.isUndefined(lastAccessed) || Date.now() - lastAccessed > CONTAINER_EXPIRY_TIME );
	} );
}

// stop any container that hasn't been accessed within ten minutes
export async function cleanupExpiredContainers() {
	const containers = Array.from( await docker.listContainers( { all: true } ) );
	const expiredContainers = getExpiredContainers(containers, getCommitAccessTime);
	expiredContainers.forEach(async (container: ContainerInfo) => {
		const imageName: string = container.Image;

		l.log({
			imageName,
			containerId: container.Id
		}, 'Cleaning up stale container' );

		try {
			if ( container.State === 'running' ) {
				await docker.getContainer(container.Id).stop();
				l.log({ containerId: container.Id, imageName }, `Successfully stopped container`);
			}
			await docker.getContainer(container.Id).remove();
			l.log({ containerId: container.Id, imageName }, `Successfully removed container`);
		} catch (err) {
			l.error({ err, imageName, containerId: container.Id }, 'Failed to stop container');
		}
	} );
}

const proxy = httpProxy.createProxyServer({}); // See (†)
export async function proxyRequestToHash(req: any, res: any) {
	const commitHash = req.session.commitHash;
	let port = await getPortForContainer(commitHash);

	if (!port) {
		l.log({ port, commitHash }, `Could not find port for commitHash`);
		res.send('Error setting up port!');
		res.end();
		return;
	}

	proxy.web(req, res, { target: `http://localhost:${port}` }, err => {
		l.log({ err, req, res }, 'unexpected error occured while proxying');
	});
}


