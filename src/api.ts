import * as Docker from 'dockerode';
import fetch from 'node-fetch';
import * as _ from 'lodash';
import * as portfinder from 'portfinder';
import * as git from 'nodegit';
import * as os from 'os';
import * as fs from 'fs-extra';
import * as path from 'path';
import { promisify } from 'util';

const docker = new Docker();
const tar: any = require('tar-fs'); // todo: write a type definition for tar-fs

// types
export type NotFound = Error;
export type CommitHash = string;
export type BranchName = string;
export type PortNumber = number;
export type ImageStatus = 'NoImage' | 'Inactive' | PortNumber;

// TODO: move out to configuration files
const REPO = 'Automattic/wp-calypso';
const TAG_PREFIX = 'dserve-wpcalypso';
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
	let freePort: number;
	try {
		freePort = await portfinder.getPortPromise();
	} catch (error) {
		log(`error getting a free port: `, error);
		return;
	}

	docker.run(image, [], process.stdout, {
		Tty: false,
		ExposedPorts: { '3000/tcp': {} },
		PortBindings: { '3000/tcp': [{ HostPort: freePort.toString() }] },
		Env: ['NODE_ENV=wpcalypso', 'CALYPSO_ENV=wpcalypso'],
	});
	await sleep(ONE_SECOND * 2);
	return;
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
	console.error(image);
	return _.has(getRunningContainers(), image);
}

// runEvery(ONE_SECOND, () => {
// 	console.error(getPortForContainer('6b6215eed45a5668010911744ec660f5f12edb74'));
// });

export async function hasHashLocally(hash: CommitHash): Promise<boolean> {
	return _.has(getLocalImages(), getImageName(hash));
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
						`Successfully stopped container with id: ${container.Id} and image name: ${imageName}`
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

/**
 * Creates an empty file at `path` if one does not exist.
 * Otherwise update the mtime to now.
 *
 * @param path path to touch
 */
async function touch(path: string) {
	return await fs.close(await fs.open(path, 'a'));
}

function getBuildDir(hash: CommitHash) {
	const tmpDir = os.tmpdir();
	return path.join(tmpDir, `dserve-build-${REPO.replace('/', '-')}-${hash}`);
}

export async function isBuildInProgress(hash: CommitHash) {
	return await fs.pathExists(getBuildDir(hash));
}

export async function buildImageForHash(hash: CommitHash) {
	const buildDir = getBuildDir(hash);

	if (await isBuildInProgress(hash)) {
		log(`skipping build for ${hash} because a build is already in progress at: ${buildDir}`);
		return;
	}

	try {
		log('1: attemping to build image for ' + hash);
		log(`2: cloning git repo for ${hash} to: ${buildDir}`);

		await promisify(fs.mkdir)(buildDir);
		// why is checking out a commit require making a branch?
		const repo = await git.Clone.clone(`https://github.com/${REPO}`, buildDir);
		const commit = await repo.getCommit(hash);
		const branch = await repo.createBranch('dserve', commit, true, undefined, undefined);
		await repo.checkoutBranch(branch);
		await touch(path.join(buildDir, 'env-config.sh')); // TODO: remove wp-calypso hack

		log('3: actually building image for ' + hash);
		const tarStream = tar.pack(buildDir);
		const buildStream = await docker.buildImage(tarStream, {
			t: getImageName(hash),
		});
		buildStream.pipe(process.stdout, {
			end: true,
		});

		let encounteredError = false;
		buildStream.on('end', () => {
			if (!encounteredError) {
				log(`successfully finished building image for ${hash}`);
			}
			log(`cleaning up build directory for ${hash}`);
			cleanUpBuildDir(hash);
		});
		buildStream.on('error', (error: any) => {
			encounteredError = true;
			log(`encountered error while building: ${hash}: `, error);
		});
	} catch (error) {
		log('failed building image because of error: ', error);
		// TODO: remember there was a failure by leaving an error file in its wake
		cleanUpBuildDir(hash);
	}
}
async function cleanUpBuildDir(hash: CommitHash) {
	const buildDir = getBuildDir(hash);
	log(`removing directory: ${buildDir}`);
	return fs.remove(buildDir);
}
