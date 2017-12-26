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
import { l, getLoggerForBuild, closeLogger } from './logger';

const docker = new Docker();
const tar: any = require('tar-fs'); // todo: write a type definition for tar-fs

// types
export type NotFound = Error;
export type CommitHash = string;
export type BranchName = string;
export type PortNumber = number;
export type ImageStatus = 'NoImage' | 'Inactive' | PortNumber;

// TODO: move out to configuration files
const BUILD_LOG_FILENAME = 'dserve-build-log.txt';
const REPO = 'Automattic/wp-calypso';
const TAG_PREFIX = 'dserve-wpcalypso';
const CLONE_PREFIX = 'git@github.com:';

export const ONE_SECOND = 1000;
export const ONE_MINUTE = 60 * ONE_SECOND;
export const FIVE_MINUTES = 5 * ONE_MINUTE;
export const TEN_MINUTES = 10 * ONE_MINUTE;

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

export const getImageName = (hash: CommitHash) => `${TAG_PREFIX}:${hash}`;

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

const getRunningContainers = (function() {
	let containers = {};
	runEvery(ONE_SECOND, async () => {
		containers = _.keyBy(await docker.listContainers(), 'Image');
	});

	return () => containers;
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
		return branchToCommitHashMap;
	} catch (err) {
		l.error({ err, repository: REPO }, 'Error creating branchName --> commitSha map');
		return;
	}
}

export const getCommitHashForBranch = (function() {
	let branches = new Map();
	runEvery(ONE_MINUTE, async () => {
		branches = await getRemoteBranches();
	});

	return function(branch: BranchName): CommitHash | undefined {
		return branches.get(branch);
	};
})();

export const { touchCommit, getCommitAccessTimes } = (function() {
	const accesses = new Map();

	const touchCommit = (hash: CommitHash) => accesses.set(getImageName(hash), Date.now());

	const getCommitAccessTimes = () => accesses;

	return { touchCommit, getCommitAccessTimes };
})();

// stop any container that hasn't been accessed within five minutes
function cleanupContainers() {
	runEvery(TEN_MINUTES, async () => {
		const containers = _.values(getRunningContainers());
		const lastAccessedTimes = getCommitAccessTimes();
		containers.forEach(async (container: any) => {
			const imageName: string = container.Image;
			const lastAccessed = lastAccessedTimes.get(imageName);
			if (!imageName.startsWith(TAG_PREFIX)) {
				return;
			}

			if (_.isUndefined(lastAccessed) || Date.now() - lastAccessed > FIVE_MINUTES) {
				l.log({ imageName }, `Attempting to stop container`);
				try {
					await docker.getContainer(container.Id).stop();
					l.log({ containerId: container.Id, imageName }, `Successfully stopped container`);
				} catch (err) {
					l.error({ err, imageName }, 'Failed to stop container.');
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

export const getLogDir = (hash: CommitHash) => path.join(getBuildDir(hash), BUILD_LOG_FILENAME);

export async function isBuildInProgress(hash: CommitHash): Promise<boolean> {
	return await fs.pathExists(getBuildDir(hash));
}
export async function readBuildLog(hash: CommitHash): Promise<string | null> {
	if (await fs.pathExists(getLogDir(hash))) {
		return fs.readFile(getLogDir(hash), 'utf-8');
	}
	return null;
}

let pendingHashes = new Set();
export async function buildImageForHash(commitHash: CommitHash): Promise<void> {
	let buildStream: ReadableStream;

	const buildDir = getBuildDir(commitHash);
	const repoDir = path.join(buildDir, 'repo');
	const pathToLog = getLogDir(commitHash);
	let imageStart: number;

	if (await isBuildInProgress(commitHash)) {
		l.log(
			{ commitHash, buildDir },
			'Skipping build because a build is already in progress according to the filesystem.'
		);
		return;
	}

	if (pendingHashes.has(commitHash)) {
		l.log(
			{ commitHash },
			`Skipping build because it is already in progress according to in-memory hash`
		);
		return;
	}
	pendingHashes.add(commitHash);

	try {
		await fs.mkdir(buildDir);
	} catch (err) {
		l.error({ err, buildDir, commitHash }, 'Could not create directory for the build');
	}
	const buildLogger = getLoggerForBuild(commitHash);

	try {
		l.log({ commitHash, buildDir }, 'Attempting to build image.');

		const cloneStart = Date.now();
		buildLogger.info('Cloning git repo');
		const repo = await git.Clone.clone(`https://github.com/${REPO}`, repoDir);
		buildLogger.info('Finished cloning repo');
		l.log({ commitHash, cloneTime: cloneStart - Date.now() });

		pendingHashes.delete(commitHash);

		const checkoutStart = Date.now();
		const commit = await repo.getCommit(commitHash);
		const branch = await repo.createBranch('dserve', commit, true, undefined, undefined);
		await repo.checkoutBranch(branch);
		l.log({ commitHash, checkoutTime: checkoutStart - Date.now() });
		buildLogger.info('Checked out the correct branch');

		buildLogger.info('Placing all the contents into a tarball stream for docker\n');
		const tarStream = tar.pack(repoDir);
		buildLogger.info('Reticulating splines\n');
		buildLogger.info('Handing off tarball to Docker for the rest of the legwork\n');
		buildLogger.info('---------------- DOCKER START ----------------');

		imageStart = Date.now();
		buildStream = await docker.buildImage(tarStream, { t: getImageName(commitHash) });
	} catch (err) {
		buildLogger.error(
			{ err },
			`Encountered error while git checking out, tarballing, or handing to docker`
		);
		l.error({ err }, `Encountered error while git checking out, tarballing, or handing to docker`);
		pendingHashes.delete(commitHash);
	}

	if (!buildStream) {
		return;
	}

	function onFinished(err: Error) {
		if (!err) {
			l.log(
				{ commitHash, buildImageTime: Date.now() - imageStart },
				`Successfully built image. Now cleaning up build directory`
			);
			cleanUpBuildDir(commitHash);
		} else {
			buildLogger.error({ err }, 'Encountered error when building image');
			l.error({ err, commitHash }, `Failed to build image for. Leaving build files in place`);
			closeLogger(buildLogger as any);
		}
	}

	function onProgress(event: any) {
		if (event.stream) {
			buildLogger.info(event.stream);
		} else {
			buildLogger.info(event);
		}
	}

	docker.modem.followProgress(buildStream, onFinished, onProgress);
}
async function cleanUpBuildDir(hash: CommitHash) {
	const buildDir = getBuildDir(hash);
	l.log(`removing directory: ${buildDir}`);
	return fs.remove(buildDir);
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
