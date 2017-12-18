// external
import * as express from 'express';
import * as httpProxy from 'http-proxy';
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
} from './api';
import { determineCommitHash, session } from './middlewares';
import renderApp from './app/index';

const proxy = httpProxy.createProxyServer({}); // See (†)

// calypso proxy server.
// checks branch names, decides to start a build or a container,
// and also proxies request to currently active container
const calypsoServer = express();
calypsoServer.use(session);
calypsoServer.use(determineCommitHash);

calypsoServer.get('*', async (req: any, res: any) => {
	const commitHash = req.session.commitHash;
	const hasLocally = await hasHashLocally(commitHash);

	if (!hasLocally) {
		if (await isBuildInProgress(commitHash)) {
			const buildLog = await readBuildLog(commitHash);
			renderApp({ buildLog }).pipe(res);
		} else {
			buildImageForHash(commitHash);
			const message = 'Starting build now';
			renderApp({ message }).pipe(res);
		}
		return;
	}

	if (!isContainerRunning(commitHash)) {
		log(`starting up container for hash: ${commitHash}\n`);
		try {
			const message = 'Just started your hash, this page will restart automatically';
			renderApp({ message }).pipe(res);
			// TODO: fix race condition where multiple containers may be spun up
			// within the same subsecond time period.
			await startContainer(commitHash);
			log(`successfully started container for hash: ${commitHash}`);
		} catch (error) {
			log(`failed at starting container for hash: ${commitHash} with error`, error);
		}
		return;
	}
	let port = await getPortForContainer(commitHash);

	if (!port) {
		log(`could not find port for hash: ${commitHash}`, port);
		return;
	}

	proxy.web(req, res, { target: `http://localhost:${port}` }, err => {
		log('unexpected error occured while proxying', err);
	});
});
calypsoServer.listen(3000, () => log('listening on 3000'));
