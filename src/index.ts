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
	readBuildLog,
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
	const restartInThreeSeconds = `
		<script>
		setTimeout( function() {
			window.location.reload();
		}, 3000 );
		</script>
	`;

	if (!hasLocally) {
		let message = 'Starting build now';

		if (await isBuildInProgress(commitHash)) {
			message = await readBuildLog(commitHash);
		} else {
			buildImageForHash(commitHash);
		}

		res.send(`
				${restartInThreeSeconds}
				${message}	
		`);

		return;
	}

	if (!isContainerRunning(commitHash)) {
		log(`starting up container for hash: ${commitHash}\n`);
		try {
			res.send(`
				${restartInThreeSeconds}
				Just started your hash, this page will restart automatically
			`);
			// TODO: fix race condition where multiple containers may be spun up
			// within the same subsecond time period.
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
