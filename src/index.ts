// external
import * as express from 'express';
import * as fs from 'fs-extra';
import * as path from 'path';

// internal
import {
	getCommitHashForBranch,
	hasHashLocally,
	CommitHash,
	NotFound,
	getPortForContainer,
	startContainer,
	isContainerRunning,
	proxyRequestToHash as proxy,
	deleteImage,
	getLocalImages,
} from './api';
import {
	isBuildInProgress,
	buildImageForHash,
	readBuildLog,
	addToBuildQueue,
	cleanupBuildDir,
} from './builder';
import { determineCommitHash, session } from './middlewares';
import renderApp from './app/index';
import { l } from './logger';
import { Writable } from 'stream';

// calypso proxy server.
// checks branch names, decides to start a build or a container,
// and also proxies request to currently active container
const calypsoServer = express();
calypsoServer.use(session);

// get application log for debugging
calypsoServer.get('/log', (req: any, res: any) => {
	const appLog = fs.readFileSync('./logs/log.txt', 'utf-8');
	res.send(appLog);
});
calypsoServer.get('/localimages', (req: any, res: any) => {
	const localImages = getLocalImages();
	res.send(JSON.stringify(localImages));
});

calypsoServer.use(determineCommitHash);

calypsoServer.get('*', async (req: any, res: any) => {
	const commitHash = req.session.commitHash;
	const hasLocally = await hasHashLocally(commitHash);
	const isCurrentlyBuilding = !hasLocally && (await isBuildInProgress(commitHash));
	const needsToBuild = !isCurrentlyBuilding && !hasLocally;
	const shouldStartContainer = hasLocally && !isContainerRunning(commitHash);
	const shouldReset = req.query.reset;

	if (shouldReset) {
		await deleteImage(commitHash);
		await cleanupBuildDir(commitHash);
		res.send('hard resetting hash: ' + commitHash);
		return;
	}

	if (isContainerRunning(commitHash)) {
		proxy(req, res);
		return;
	}

	let buildLog;
	let message;
	if (isCurrentlyBuilding) {
		buildLog = await readBuildLog(commitHash);
	} else if (needsToBuild) {
		message = 'Starting build now';
		addToBuildQueue(commitHash);
	} else if (shouldStartContainer) {
		message = 'Just started your hash, this page will restart automatically';
		// TODO: fix race condition where multiple containers may be spun up
		// within the same subsecond time period.
		await startContainer(commitHash);
	}

	renderApp({ message, buildLog }).pipe(res);
});

calypsoServer.listen(3000, () => l.log('dserve is listening on 3000'));
