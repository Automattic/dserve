const express = require('express');
var Docker = require('dockerode');
var docker = new Docker();

type CommitHash = string;
type BranchName = string;
type PortNumber = number;
type ImageStatus = 'NoImage' | 'Inactive' | PortNumber;

async function hasCommitHashLocally(branch: BranchName): Promise<boolean> {
	return false;
}

async function getCommitHashForBranch(branch: BranchName): Promise<CommitHash> {
	return 'a8ejxk8';
}

async function hasBranchLocally(branch: BranchName): Promise<boolean> {
	const commitHash = await getCommitHashForBranch(branch);
	return hasCommitHashLocally(commitHash);
}

async function getImageStatus(hash: CommitHash): Promise<ImageStatus> {
	return 'NoImage';
}

const builds: Array<CommitHash> = [];
function getBuildsInProgress(): Array<CommitHash> {
	return builds;
}

const calypsoServer = express();
calypsoServer.get('*', async (req: any, res: any) => {
	if (!req.query || (!req.query.hash && !req.query.branch)) {
		res.send('TODO: remember last accessed branch. Until then - specify branch');
		return;
	}
	const commitHash = !!req.query.hash
		? req.query.hash
		: await getCommitHashForBranch(req.query.branch);

	res.send(`Calypso Server: serving up hash: ${commitHash}`);
});
calypsoServer.listen(3000, () => console.log('listening on 3000'));

const imageServer = express();
imageServer.get('/', async (req: any, res: any) => {
	res.send(`Image Server`);
});
imageServer.listen(3001, () => console.log('Example app listening on port 3001'));
