// external
import * as express from 'express';
import * as httpProxy from 'http-proxy';
import * as expressSession from 'express-session';

// internal
import {
	getCommitHashForBranch,
	hasHashLocally,
	CommitHash,
	NotFound,
	getPortForContainer,
	touchCommit,
} from './api';

export async function determineCommitHash(req: any, res: any, next: any) {
	const isHashInSession = !!req.session.commitHash;
	const isHashSpecified = req.query && (req.query.hash || req.query.branch);
	let commitHash;

	if (!isHashInSession && !isHashSpecified) {
		res.send('Please specify a branch to load');
		return;
	}

	if (req.query.hash) {
		commitHash = req.query.hash;
	} else if (req.query.branch) {
		commitHash = await getCommitHashForBranch(req.query.branch);
	} else {
		commitHash = req.session.commitHash;
	}

	if (commitHash instanceof Error) {
		res.send('Calypso Server: ' + commitHash.message);
		return;
	}

	req.session.commitHash = commitHash;
	touchCommit(commitHash);

	next();
}

export const session = expressSession({
	secret: 'keyboard cat',
	cookie: {},
	resave: false,
	saveUninitialized: true,
});
