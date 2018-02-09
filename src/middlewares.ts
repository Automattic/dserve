// external
import * as express from 'express';
import * as httpProxy from 'http-proxy';
import * as expressSession from 'express-session';
import * as _ from 'lodash';
import * as striptags from 'striptags';

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
	let branch;

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
		branch = req.query.branch;
	}

	if (commitHash instanceof Error) {
		res.send(striptags('Calypso Server: ' + commitHash.message));
		return;
	} else if (branch && _.isUndefined(commitHash)) {
		res.send(striptags(`Please specify a valid branch.  Could not find: ${branch}`));
		return;
	}

	req.session.commitHash = commitHash;
	req.session.branch = branch;
	touchCommit(commitHash);

	next();
}

export const session = expressSession({
	secret: 'keyboard cat',
	cookie: {},
	resave: false,
	saveUninitialized: true,
});
