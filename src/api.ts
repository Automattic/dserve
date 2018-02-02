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

import { l, getLoggerForBuild, closeLogger } from './logger';
import { getBuildDir } from './builder';
import { setInterval } from 'timers';

export const docker = new Docker();

// types
export type NotFound = Error;
export type CommitHash = string;
export type BranchName = string;
export type PortNumber = number;
export type ImageStatus = 'NoImage' | 'Inactive' | PortNumber;

// TODO: move out to configuration files
export const BUILD_LOG_FILENAME = 'dserve-build-log.txt';
export const REPO = 'Automattic/wp-calypso';
export const TAG_PREFIX = 'dserve-wpcalypso';
const CLONE_PREFIX = 'git@github.com:';

export const ONE_SECOND = 1000;
export const ONE_MINUTE = 60 * ONE_SECOND;
export const FIVE_MINUTES = 5 * ONE_MINUTE;
export const TEN_MINUTES = 10 * ONE_MINUTE;
export const CONTAINER_EXPIRY_TIME = FIVE_MINUTES;

export const getImageName = (hash: CommitHash) => `${TAG_PREFIX}:${hash}`;
export const extractCommitFromImage = (imageName: string): CommitHash => imageName.split(':')[1];

/**
 * Returns which images are stored locally.
 * Polls locker docker daemon for image list
 */
export const { refreshLocalImages, getLocalImages } = (function() {
	let localImages = {};
	return {
		refreshLocalImages: async () => {
			localImages = _.keyBy(await docker.listImages(), 'RepoTags');
		},
		getLocalImages: () => localImages,
	};
})();

export async function deleteImage(hash: CommitHash) {
	l.log({ commitHash: hash }, 'attempting to remove image for hash');

	const runningContainer = getRunningContainers()[getImageName(hash)];
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

// docker run -it --name wp-calypso --rm -p 80:3000 -e
// NODE_ENV=wpcalypso -e CALYPSO_ENV=wpcalypso wp-calypso"
export async function startContainer(commitHash: CommitHash) {
	l.log({ commitHash }, `Starting up container`);
	const image = getImageName(commitHash);
	let freePort: number;
	try {
		freePort = await portfinder.getPortPromise();
	} catch (err) {
		l.error({ err, commitHash }, `Error while attempting to find a free port`);
		return;
	}

	docker.run(
		image,
		[],
		process.stdout,
		{
			Tty: false,
			ExposedPorts: { '3000/tcp': {} },
			PortBindings: { '3000/tcp': [{ HostPort: freePort.toString() }] },
			Env: ['NODE_ENV=wpcalypso', 'CALYPSO_ENV=wpcalypso'],
		},
		(err, succ) => {
			if (err) {
				l.error({ commitHash, freePort, err }, `failed starting container`);
				return;
			}
			l.log({ commitHash, freePort }, `successfully started container: ${succ}`);
		}
	);
	return;
}

const { getRunningContainers, refreshRunningContainers } = (function() {
	let containers: { [s: string]: ContainerInfo } = {};
	return {
		refreshRunningContainers: async () => {
			containers = _.keyBy(await docker.listContainers(), 'Image');
		},
		getRunningContainers: () => containers,
	};
})();

export function isContainerRunning(hash: CommitHash) {
	const image = getImageName(hash);
	return _.has(getRunningContainers(), image);
}

export async function hasHashLocally(hash: CommitHash): Promise<boolean> {
	return _.has(getLocalImages(), getImageName(hash));
}

export function getPortForContainer(hash: CommitHash): Promise<boolean> {
	const image = getImageName(hash);
	return _.get(getRunningContainers(), [image, 'Ports', 0, 'PublicPort'], false);
}

async function getRemoteBranches(): Promise<Map<string, string>> {
	const repoDir = path.join(__dirname, '../repos');
	const calypsoDir = path.join(repoDir, 'wp-calypso');
	let repo: git.Repository;

	const start = Date.now();
	l.log({ repository: REPO }, 'Refreshing branches list');

	try {
		if (!await fs.pathExists(repoDir)) {
			await fs.mkdir(repoDir);
		}
		if (!await fs.pathExists(calypsoDir)) {
			repo = await git.Clone.clone(`https://github.com/${REPO}`, calypsoDir);
		} else {
			repo = await git.Repository.open(calypsoDir);
		}
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

		const branchToCommitHashMap: Map<string, string> = new Map();
		branchesReferences.forEach(async reference => {
			const name = reference.shorthand().replace('origin/', '');
			const commitHash = reference.target().tostrS();
			branchToCommitHashMap.set(name, commitHash);
		});

		l.log(
			{ repository: REPO, refreshBranchTime: Date.now() - start },
			'Finished refreshing branches'
		);

		repo.free(); 
		return branchToCommitHashMap;
	} catch (err) {
		l.error({ err, repository: REPO }, 'Error creating branchName --> commitSha map');
		return;
	}
}

export const { refreshRemoteBranches, getCommitHashForBranch } = (function() {
	let branches = new Map();
	return {
		refreshRemoteBranches: async () => {
			branches = await getRemoteBranches();
		},
		getCommitHashForBranch: function(branch: BranchName): CommitHash | undefined {
			return branches.get(branch);
		},
	};
})();

export const { touchCommit, getCommitAccessTime } = (function() {
	const accesses = new Map();

	const touchCommit = (hash: CommitHash) => accesses.set(hash, Date.now());

	const getCommitAccessTime = (hash: CommitHash) => accesses.get(hash);

	return { touchCommit, getCommitAccessTime };
})();

/*
 * Get all currently running containers that were created by dserve and have expired.
 * Expired means have not been accessed in EXPIRED_DURATION
 */
export function getExpiredContainers(containers: Array<ContainerInfo>, getAccessTime: Function) {
	return containers.filter((container: ContainerInfo) => {
		const imageName: string = container.Image;

		// exclude container if it wasnt created by this app
		if (!imageName.startsWith(TAG_PREFIX)) {
			return;
		}

		const lastAccessed = getAccessTime(extractCommitFromImage(imageName));
		return _.isUndefined(lastAccessed) || Date.now() - lastAccessed > CONTAINER_EXPIRY_TIME;
	});
}

// stop any container that hasn't been accessed within ten minutes
function cleanupExpiredContainers() {
	const containers = _.values(getRunningContainers());
	const expiredContainers = getExpiredContainers(containers, getCommitAccessTime);
	expiredContainers.forEach(async (container: ContainerInfo) => {
		const imageName: string = container.Image;

		l.log({ imageName }, `Attempting to stop container because it hasn't been accessed in a while`);
		try {
			await docker.getContainer(container.Id).stop();
			l.log({ containerId: container.Id, imageName }, `Successfully stopped container`);
		} catch (err) {
			l.error({ err, imageName }, 'Failed to stop container.');
		}
	});
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

if (process.env.NODE_ENV !== 'test') {
	// first run
	refreshLocalImages();
	refreshRunningContainers();
	refreshRemoteBranches();

	// setup for future
	setInterval(cleanupExpiredContainers, TEN_MINUTES);
	setInterval(refreshLocalImages, ONE_SECOND);
	setInterval(refreshRunningContainers, ONE_SECOND);
	setInterval(refreshRemoteBranches, ONE_MINUTE);
}
