import fetch from 'node-fetch';

// types
type NotFound = Error;
type CommitHash = string;
type BranchName = string;
type PortNumber = number;
type ImageStatus = 'NoImage' | 'Inactive' | PortNumber;

// constants
const REPO = 'Automattic/wp-calypso';
const BRANCH_URL = 'https://api.github.com/repos/Automattic/wp-calypso/branches/';

function log(...args: Array<any>) {
	console.log(...args);
}

export async function hasCommitHashLocally(branch: BranchName): Promise<boolean> {
	return false;
}

export async function getCommitHashForBranch(branch: BranchName): Promise<CommitHash | NotFound> {
	const response = await (await fetch(BRANCH_URL + branch)).json();

	if (!response.commit) {
		return new Error(`branch ${branch} not found`);
	}

	return response.commit.sha;
}

export async function hasBranchLocally(branch: BranchName): Promise<boolean> {
	const commitHash = await getCommitHashForBranch(branch);

	if (commitHash instanceof Error) {
		return false;
	}

	return hasCommitHashLocally(commitHash);
}

export async function getImageStatus(hash: CommitHash): Promise<ImageStatus> {
	return 'NoImage';
}
