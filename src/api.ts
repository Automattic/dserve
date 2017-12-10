import * as Docker from 'dockerode';
import fetch from 'node-fetch';
import * as _ from 'lodash';
import * as portfinder from 'portfinder';
// import { setTimeout } from 'timers';
const docker = new Docker();

// types
export type NotFound = Error;
export type CommitHash = string;
export type BranchName = string;
export type PortNumber = number;
export type ImageStatus = 'NoImage' | 'Inactive' | PortNumber;

// TODO: move out to configuration files
const REPO = 'Automattic/wp-calypso';
const TAG_PREFIX = 'wp-calypso';
const BRANCH_URL = 'https://api.github.com/repos/Automattic/wp-calypso/branches/';
const ONE_SECOND = 1000;
const FIVE_MINUTES = 300000;

export const log = (...args: Array<any>) => console.log(...args);

async function sleep(ms: number): Promise<any> {
	return new Promise(r => setTimeout(r, ms));
}

/**
 *
 * @param ms milliseconds to wait before calling the function again. The clock
 *           doesn't start counting down until the function finishes
 * @param fn function to call
 */
function runEvery(ms: number, fn: Function): void {
	_.defer(async () => {
		while (true) {
			await fn();
			await sleep(ms);
		}
	});
}

const getImageName = (hash: CommitHash) => `${TAG_PREFIX}:${hash}`;

/**
 * Returns which images are stored locally.
 * Polls locker docker daemon for image list
 */
const getLocalImages = (function() {
	let localImages = {};

	runEvery(ONE_SECOND, async () => {
		localImages = _.keyBy(await docker.listImages(), 'RepoTags');
	});

	return () => localImages;
})();

// docker run -it --name wp-calypso --rm -p 80:3000 -e
// NODE_ENV=wpcalypso -e CALYPSO_ENV=wpcalypso wp-calypso"
export async function startContainer(hash: CommitHash) {
	const image = getImageName(hash);
	let freePort;
	try {
		freePort = await portfinder.getPortPromise();
	} catch (error) {
		log(`error getting a free port: `, error);
		return;
	}

	try {
		const container = await docker.run(image, [], process.stdout, {
			Tty: false,
			ExposedPorts: { '3000/tcp': {} },
			PortBindings: { '3000/tcp': [{ HostPort: freePort.toString() }] },
			Env: ['NODE_ENV=wpcalypso', 'CALYPSO_ENV=wpcalypso'],
		});
		return container;
	} catch (error) {
		log(`error starting container with error: `, error);
		return false;
	}
}

const getRunningContainers = (function() {
	let containers = {};
	runEvery(ONE_SECOND, async () => {
		containers = _.keyBy(await docker.listContainers(), 'Image');
	});

	return () => containers;
})();

export function isContainerRunning(hash: CommitHash) {
	const image = getImageName(hash);
	return _.has(getRunningContainers, image);
}

// runEvery(ONE_SECOND, () => {
// 	console.error(getPortForContainer('6b6215eed45a5668010911744ec660f5f12edb74'));
// });

export async function hasHashLocally(hash: CommitHash): Promise<boolean> {
	return _.has(getLocalImages(), `${TAG_PREFIX}:${hash}`);
}

export function getPortForContainer(hash: CommitHash): Promise<boolean> {
	const image = getImageName(hash);
	return _.get(getRunningContainers(), [image, 'Ports', 0, 'PublicPort'], false);
}

export async function getCommitHashForBranch(branch: BranchName): Promise<CommitHash | NotFound> {
	const response = await (await fetch(BRANCH_URL + branch)).json();

	if (!response.commit) {
		return new Error(`branch ${branch} not found`);
	}

	return response.commit.sha;
}

export const { touchCommit, getCommitAccessTimes } = (function() {
	const accesses = new Map();

	const touchCommit = (hash: CommitHash) => accesses.set(getImageName(hash), Date.now());

	const getCommitAccessTimes = () => accesses;

	return { touchCommit, getCommitAccessTimes };
})();

// stop any container that hasn't been accessed within five minutes
function cleanupContainers() {
	runEvery(FIVE_MINUTES, async () => {
		const containers = _.values(getRunningContainers());
		const lastAccessedTimes = getCommitAccessTimes();
		containers.forEach(async (container: any) => {
			const imageName = container.Image;
			const lastAccessed = lastAccessedTimes.get(imageName);

			if (_.isUndefined(lastAccessed) || Date.now() - lastAccessed > FIVE_MINUTES) {
				log(`Attempting to stop container: ${imageName}`);
				try {
					await docker.getContainer(container.Id).stop();
					log(
						`Successfully stopped container with id: ${container.id} and image name: ${imageName}`
					);
				} catch (error) {
					log(
						`Did not successfully stop container: ${imageName}.
					  experienced error: `,
						error
					);
				}
			}
		});
	});
}

cleanupContainers();
