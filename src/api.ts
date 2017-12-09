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

function log(...args: Array<any>) {
	console.log(...args);
}

async function sleep(ms: number): Promise<any> {
	return new Promise(r => setTimeout(r, ms));
}

function runEvery(ms: number, fn: Function): void {
	_.defer(async () => {
		while (true) {
			fn();
			await sleep(ONE_SECOND);
		}
	});
}

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
async function startContainer(hash: CommitHash) {
	const image = `wp-calypso:${hash}`;
	const freePort = await portfinder.getPortPromise();
	const container = await docker.run(image, [], process.stdout, {
		Tty: false,
		ExposedPorts: { '3000/tcp': {} },
		PortBindings: { '3000/tcp': [{ HostPort: '3002' }] },
		Env: ['NODE_ENV=wpcalypso', 'CALYPSO_ENV=wpcalypso'],
	});
}
// startContainer('6b6215eed45a5668010911744ec660f5f12edb74');
const getRunningContainers = (function() {
	let containers = {};
	runEvery(ONE_SECOND, async () => {
		containers = _.keyBy(await docker.listContainers(), 'Image');
	});

	return () => containers;
})();

// runEvery(ONE_SECOND, () => {
// 	console.error(getPortForContainer('6b6215eed45a5668010911744ec660f5f12edb74'));
// });

export async function hasHashLocally(hash: CommitHash): Promise<boolean> {
	return _.has(getLocalImages(), `${TAG_PREFIX}:${hash}`);
}

export function getPortForContainer(hash: CommitHash): Promise<boolean> {
	return _.get(getRunningContainers(), [`${TAG_PREFIX}:${hash}`, 'Ports', 0, 'PublicPort'], false);
}

export async function getCommitHashForBranch(branch: BranchName): Promise<CommitHash | NotFound> {
	const response = await (await fetch(BRANCH_URL + branch)).json();

	if (!response.commit) {
		return new Error(`branch ${branch} not found`);
	}

	return response.commit.sha;
}

export async function getImageStatus(hash: CommitHash): Promise<ImageStatus> {
	return 'NoImage';
}
