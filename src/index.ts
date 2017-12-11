// external
import * as express from 'express';
import * as httpProxy from 'http-proxy';

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
} from './api';
import { determineCommitHash, session } from './middlewares';

var proxy = httpProxy.createProxyServer({}); // See (†)

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
			res.send(
				'Good news! The build for this branch is currenlty under-way. Please give me up to 6 minutes to build'
			);
		} else {
			res.send(`We do not have this build ready yet. Starting the build now!`);
			buildImageForHash(commitHash);
		}
		return;
	}

	if (!isContainerRunning(commitHash)) {
		log(`starting up container for hash: ${commitHash}\n`);
		try {
			res.send('Just started your hash, try refreshing in two seconds');
			await startContainer(commitHash);
			log(`successfully started container for hash: ${commitHash}`);
			return;
		} catch (error) {
			log(`failed at starting container for hash: ${commitHash} with error`, error);
		}
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

const imageServer = express();
imageServer.get('/', async (req: any, res: any) => {
	res.send(`Image Server`);
});
imageServer.listen(3001, () => log('Example app listening on port 3001'));
