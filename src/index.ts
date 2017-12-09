// external
import * as express from 'express';
import * as httpProxy from 'http-proxy';
import * as session from 'express-session';

// internal
import {
	getCommitHashForBranch,
	hasHashLocally,
	CommitHash,
	NotFound,
	getPortForContainer,
} from './api';

var proxy = httpProxy.createProxyServer({}); // See (†)

// calypso proxy server.
// checks branch names, decides to start a build or a container,
// and also proxies request to currently active container
const calypsoServer = express();
calypsoServer.use(
	session({
		secret: 'keyboard cat',
		cookie: {},
		resave: false,
		saveUninitialized: true,
	})
);
calypsoServer.get('*', async (req: any, res: any) => {
	console.error(req.session);
	// first things first, lets figure out which commit they want
	if (req.query && (req.query.hash || req.query.branch)) {
		const commitHash = !!req.query.hash
			? req.query.hash
			: await getCommitHashForBranch(req.query.branch);

		if (commitHash instanceof Error) {
			res.send('Calypso Server: ' + commitHash.message);
			return;
		}
		req.session.commitHash = commitHash;
	} else if (!req.session.commitHash) {
		res.send('Please specify a branch to load');
		return;
	}
	const commitHash = req.session.commitHash;

	const hasLocally = await hasHashLocally(commitHash);
	if (!hasLocally) {
		res.send(`Need to build this commit <i>${commitHash}</i>, seems, I do not have it locally`);
		return;
	}
	const port = await getPortForContainer(commitHash);

	// console.error(port);
	// if (!port) {
	// 	// spin up container
	// 	res.send('need to start container');
	// 	console.error('need to start container');
	// }
	proxy.web(req, res, { target: `http://localhost:${port}` });
});
calypsoServer.listen(3000, () => console.log('listening on 3000'));

const imageServer = express();
imageServer.get('/', async (req: any, res: any) => {
	res.send(`Image Server`);
});
imageServer.listen(3001, () => console.log('Example app listening on port 3001'));
