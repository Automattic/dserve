import * as git from 'nodegit';
import * as os from 'os';
import * as fs from 'fs-extra';
import * as path from 'path';
import { Readable } from 'stream';
const tar: any = require('tar-fs'); // todo: write a type definition for tar-fs

import {
	CommitHash,
	ONE_SECOND,
	ONE_MINUTE,
	FIVE_MINUTES,
	getImageName,
	docker,
} from './api';
import {config} from './config';
import { closeLogger, l, getLoggerForBuild } from './logger';

type BuildQueue = Array<CommitHash>;

export const MAX_CONCURRENT_BUILDS = 3;
const BUILD_QUEUE: BuildQueue = [];
const pendingHashes = new Set();

export const getLogPath = (hash: CommitHash) => path.join(getBuildDir(hash), config.build.logFilename);
export async function isBuildInProgress(
	hash: CommitHash,
	currentBuilds = getCurrentBuilds()
): Promise<boolean> {
	return (await fs.pathExists(getBuildDir(hash))) || currentBuilds.has(hash);
}
const getCurrentBuilds = () => pendingHashes;

export async function readBuildLog(hash: CommitHash): Promise<string | null> {
	if (await fs.pathExists(getLogPath(hash))) {
		return fs.readFile(getLogPath(hash), 'utf-8');
	}
	return null;
}

export function getBuildDir(hash: CommitHash) {
	const tmpDir = os.tmpdir();
	return path.join(tmpDir, `dserve-build-${config.repo.project.replace('/', '-')}-${hash}`);
}

export async function cleanupBuildDir(hash: CommitHash) {
	const buildDir = getBuildDir(hash);
	l.log(`removing directory: ${buildDir}`);
	return fs.remove(buildDir);
}

function warnOnQueueBuildup(buildQueue = BUILD_QUEUE) {
	if (buildQueue.length > 0) {
		l.log(
			{ buildQueueSize: buildQueue.length },
			'There are images waiting to be built that are stuck because of too many concurrent builds'
		);
	}
}

export function buildFromQueue({
	buildQueue = BUILD_QUEUE,
	currentBuilds = getCurrentBuilds(),
	builder = buildImageForHash,
} = {}) {
	if (buildQueue.length == 0) {
		return;
	}

	if (currentBuilds.size < MAX_CONCURRENT_BUILDS) {
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
	}
}

export function addToBuildQueue(
	commitHash: CommitHash,
	buildQueue: BuildQueue = BUILD_QUEUE,
	currentBuilds: Set<CommitHash> = getCurrentBuilds()
) {
	if (buildQueue.includes(commitHash) || currentBuilds.has(commitHash)) {
		l.log(
			{ buildQueueSize: buildQueue.length, commitHash },
			'Skipping the build queue since it is already in it'
		);
		return;
	}
	l.log({ buildQueueSize: buildQueue.length, commitHash }, 'Adding a commitHash to the buildQueue');
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
	const pathToLog = getLogPath(commitHash);
	const imageName = getImageName(commitHash);
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
		l.log({ commitHash, buildDir, repoDir, imageName }, 'Attempting to build image.');

		const cloneStart = Date.now();
		buildLogger.info('Cloning git repo');
		const repo = await git.Clone.clone(`https://github.com/${config.repo.project}`, repoDir);
		buildLogger.info('Finished cloning repo');
		l.log({ commitHash, cloneTime: cloneStart - Date.now() });

		const checkoutStart = Date.now();
		const commit = await repo.getCommit(commitHash);
		const branch = await repo.createBranch('dserve', commit, true, undefined, undefined);
		await repo.checkoutBranch(branch);
		repo.free();
		l.log({ commitHash, checkoutTime: checkoutStart - Date.now() });
		buildLogger.info('Checked out the correct branch');

		buildLogger.info('Placing all the contents into a tarball stream for docker\n');
		l.log(
			{ repoDir, imageName },
			'Placing contents of repoDir into a tarball and sending to docker for a build'
		);
		const tarStream = tar.pack(repoDir);
		buildLogger.info('Reticulating splines\n');
		buildLogger.info('Handing off tarball to Docker for the rest of the legwork\n');
		buildLogger.info('---------------- DOCKER START ----------------');

		imageStart = Date.now();
		buildStream = await docker.buildImage(tarStream, {
			t: imageName,
			nocache: false,
			buildargs: {
				commit_sha: commitHash,
			},
		});
	} catch (err) {
		buildLogger.error(
			{ err },
			`Encountered error while git checking out, tarballing, or handing to docker`
		);
		l.error({ err }, `Encountered error while git checking out, tarballing, or handing to docker`);
		pendingHashes.delete(commitHash);
	}

	if (!buildStream) {
		l.error({buildStream}, "Failed to build image but didn't throw an error" );
		return;
	}

	function onFinished(err: Error) {
		onBuildComplete();
		if (!err) {
			l.log(
				{ commitHash, buildImageTime: Date.now() - imageStart, repoDir, imageName },
				`Successfully built image. Now cleaning up build directory`
			);
			// TODO: maybe re-enable cleanup.  disabled for now to aid in debugging
			// cleanupBuildDir(commitHash);
		} else {
			buildLogger.error({ err }, 'Encountered error when building image');
			l.error({ err, commitHash }, `Failed to build image for. Leaving build files in place`);
		}
		closeLogger(buildLogger as any);
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
setInterval(() => warnOnQueueBuildup(), ONE_MINUTE);
