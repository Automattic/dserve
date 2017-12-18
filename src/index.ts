// external
import * as express from 'express';
import * as fs from 'fs-extra';

// internal
import {
	getCommitHashForBranch,
	hasHashLocally,
	CommitHash,
	NotFound,
	getPortForContainer,
	startContainer,
	log,
	isContainerRunning,
	isBuildInProgress,
	buildImageForHash,
	readBuildLog,
	proxyRequestToHash as proxy,
} from './api';
import { determineCommitHash, session } from './middlewares';
import renderApp from './app/index';

// calypso proxy server.
// checks branch names, decides to start a build or a container,
// and also proxies request to currently active container
const calypsoServer = express();
calypsoServer.use(session);
calypsoServer.use(determineCommitHash);

calypsoServer.get('*', async (req: any, res: any) => {
	const commitHash = req.session.commitHash;
	const hasLocally = await hasHashLocally(commitHash);
	const isCurrentlyBuilding = hasLocally && (await isBuildInProgress(commitHash));
	const needsToBuild = !isCurrentlyBuilding && !hasLocally;
	const shouldStartContainer = hasLocally && !isContainerRunning(commitHash);

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
		buildImageForHash(commitHash);
	} else if (shouldStartContainer) {
		message = 'Just started your hash, this page will restart automatically';
		// TODO: fix race condition where multiple containers may be spun up
		// within the same subsecond time period.
		await startContainer(commitHash);
	} 

	renderApp({ message, buildLog }).pipe(res);
});
calypsoServer.listen(3000, () => log('listening on 3000'));
