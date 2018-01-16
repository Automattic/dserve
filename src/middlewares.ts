// external
import * as express from 'express';
import * as httpProxy from 'http-proxy';
import * as expressSession from 'express-session';
import * as _ from 'lodash';

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

	if (isHashInSession && !isHashSpecified) {
		next();
		return;
	}

	if (!isHashSpecified) {
		res.send('Please specify a branch to load');
		return;
	}

	if (req.query.hash) {
		commitHash = req.query.hash;
	} else if (req.query.branch) {
		commitHash = getCommitHashForBranch(req.query.branch);
	}

	if (commitHash instanceof Error) {
		res.send('Calypso Server: ' + commitHash.message);
		return;
	} else if (req.query.branch && _.isUndefined(commitHash)) {
		res.send(`Please specify a valid branch.  Could not find: ${req.query.branch}`);
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
