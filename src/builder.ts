import * as git from 'nodegit';
import * as os from 'os';
import * as fs from 'fs-extra';
import * as path from 'path';
import { Readable } from 'stream';
const tar: any = require('tar-fs'); // todo: write a type definition for tar-fs

import {
	CommitHash,
	REPO,
	ONE_SECOND,
	ONE_MINUTE,
	FIVE_MINUTES,
	BUILD_LOG_FILENAME,
	getImageName,
	docker,
} from './api';
import { closeLogger, l, getLoggerForBuild } from './logger';

type BuildQueue = Array<CommitHash>;

const MAX_CONCURRENT_BUILDS = 3;
const BUILD_QUEUE: BuildQueue = [];
const pendingHashes = new Set();

export const getLogDir = (hash: CommitHash) => path.join(getBuildDir(hash), BUILD_LOG_FILENAME);
export async function isBuildInProgress(
	hash: CommitHash,
	currentBuilds = getCurrentBuilds()
): Promise<boolean> {
	return (await fs.pathExists(getBuildDir(hash))) || currentBuilds.has(hash);
}
const getCurrentBuilds = () => pendingHashes;

export async function readBuildLog(hash: CommitHash): Promise<string | null> {
	if (await fs.pathExists(getLogDir(hash))) {
		return fs.readFile(getLogDir(hash), 'utf-8');
	}
	return null;
}

export function getBuildDir(hash: CommitHash) {
	const tmpDir = os.tmpdir();
	return path.join(tmpDir, `dserve-build-${REPO.replace('/', '-')}-${hash}`);
}

async function cleanUpBuildDir(hash: CommitHash) {
	const buildDir = getBuildDir(hash);
	l.log(`removing directory: ${buildDir}`);
	return fs.remove(buildDir);
}

export function buildFromQueue({
	buildQueue = BUILD_QUEUE,
	currentBuilds = getCurrentBuilds(),
	builder = buildImageForHash,
} = {}) {
	if (buildQueue.length > 0) {
		if (currentBuilds.size <= MAX_CONCURRENT_BUILDS) {
			const commit = buildQueue.shift();
			l.log(
				{ buildQueueSize: buildQueue.length, commitHash: commit },
				'Popping a commitHash off of the buildQueue'
			);
			builder(commit, {
				onBuildComplete: () => {
					currentBuilds.delete(commit);
				},
				currentBuilds,
			});
		} else {
			l.log(
				{ buildQueueSize: buildQueue.length },
				'There images waiting to be built that are stuck because of too many concurrent builds'
			);
		}
	}
}

export function addToBuildQueue(
	commitHash: CommitHash,
	buildQueue: BuildQueue = BUILD_QUEUE,
	currentBuilds: Set<CommitHash> = getCurrentBuilds()
) {
	if (buildQueue.includes(commitHash) || currentBuilds.has(commitHash)) {
		return;
	}
	return buildQueue.push(commitHash);
}

export async function buildImageForHash(
	commitHash: CommitHash,
	{
		onBuildComplete,
		currentBuilds = getCurrentBuilds(),
	}: { onBuildComplete: Function; currentBuilds?: Set<CommitHash> }
): Promise<void> {
	let buildStream: Readable;

	const buildDir = getBuildDir(commitHash);
	const repoDir = path.join(buildDir, 'repo');
	const pathToLog = getLogDir(commitHash);
	let imageStart: number;

	if (await isBuildInProgress(commitHash, currentBuilds)) {
		l.log({ commitHash, buildDir }, 'Skipping build because a build is already in progress');
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
		onBuildComplete();
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
			buildLogger.info({ fromDocker: true }, event.stream);
		} else {
			buildLogger.info({ fromDocker: true }, event);
		}
	}

	docker.modem.followProgress(buildStream, onFinished, onProgress);
}

setInterval(() => buildFromQueue(), ONE_SECOND);
