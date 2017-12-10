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
		res.send(`Need to build this commit <i>${commitHash}</i>, seems, I do not have it locally`);
		return;
	}
	let port = await getPortForContainer(commitHash);

	if (!port) {
		log(`starting up container for hash: ${commitHash}`);
		await startContainer(commitHash);
		port = await getPortForContainer(commitHash);
	}
	proxy.web(req, res, { target: `http://localhost:${port}` });
});
calypsoServer.listen(3000, () => log('listening on 3000'));

const imageServer = express();
imageServer.get('/', async (req: any, res: any) => {
	res.send(`Image Server`);
});
imageServer.listen(3001, () => console.log('Example app listening on port 3001'));
