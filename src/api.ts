var Docker = require('dockerode');
var docker = new Docker();

type CommitHash = string;
type BranchName = string;
type PortNumber = number;
type ImageStatus = 'NoImage' | 'Inactive' | PortNumber;

export async function hasCommitHashLocally(branch: BranchName): Promise<boolean> {
	return false;
}

export async function getCommitHashForBranch(branch: BranchName): Promise<CommitHash> {
	return 'a8ejxk8';
}

export async function hasBranchLocally(branch: BranchName): Promise<boolean> {
	const commitHash = await getCommitHashForBranch(branch);
	return hasCommitHashLocally(commitHash);
}

export async function getImageStatus(hash: CommitHash): Promise<ImageStatus> {
	return 'NoImage';
}

// const builds: Array<CommitHash> = [];
// function getBuildsInProgress(): Array<CommitHash> {
// 	return builds;
// }
