// external
import * as express from 'express';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as striptags from 'striptags';

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
	const appLog = fs.readFileSync('./logs/log.txt', 'utf-8'); // todo change back from l
	res.send(appLog);
});

calypsoServer.get('/localimages', (req: any, res: any) => {
	const localImages = Array
		.from(getLocalImages())
		.reduce( 
			( images, [ repoTags, image ] ) => ( { ...images, [ repoTags ]: image } ), 
			{} 
		);

	res.send(JSON.stringify(localImages));
});

calypsoServer.use(determineCommitHash);
calypsoServer.get('/status', async (req: any, res: any) => {
	const commitHash = req.session.commitHash;
	let status;
	if (isContainerRunning(commitHash)) {
		status = 'Ready';
	} else if (await hasHashLocally(commitHash)) {
		status = 'NeedsPriming';
	} else if (await isBuildInProgress(commitHash)) {
		status = 'Building';
	} else {
		status = 'NotBuilt';
	}
	res.send(status);
	res.end();
});

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
		const response = `hard resetting hash: ${commitHash}`;
		res.send(striptags(response));
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
