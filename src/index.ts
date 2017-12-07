// external
import * as express from 'express';
import * as Docker from 'dockerode';

// internal
import { getCommitHashForBranch } from './api';

const docker = new Docker();

// calypso proxy server.
// checks branch names, decides to start a build or a container,
// and also proxies request to currently active container
const calypsoServer = express();
calypsoServer.get('*', async (req: any, res: any) => {
	if (!req.query || (!req.query.hash && !req.query.branch)) {
		res.send('TODO: remember last accessed branch. Until then - specify branch');
		return;
	}

	const commitHash = !!req.query.hash
		? req.query.hash
		: await getCommitHashForBranch(req.query.branch);

	if (commitHash instanceof Error) {
		res.send('Calypso Server: ' + commitHash.message);
	}

	res.send(`Calypso Server: serving up hash: ${commitHash}`);
});
calypsoServer.listen(3000, () => console.log('listening on 3000'));

const imageServer = express();
imageServer.get('/', async (req: any, res: any) => {
	res.send(`Image Server`);
});
imageServer.listen(3001, () => console.log('Example app listening on port 3001'));
