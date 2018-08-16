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

function assembleSubdomainUrlForHash(req: any, commitHash: any) {
    const protocol = (req.secure ? 'https' : 'http');

    return protocol + '://' + commitHash + '.' + req.headers.host;
}

function getCommitHashFromSubdomain(req: any) {
    return req.headers.host.substring(0, req.headers.host.indexOf('.'));
}

export async function redirectHashFromQueryStringToSubdomain(req: any, res: any, next: any) {
    const isHashSpecified = req.query && (req.query.hash || req.query.branch);

    let commitHash;

    if (!isHashSpecified) {
        next();
        return;
    }

    if (req.query.hash) {
		commitHash = req.query.hash;
	} else if (req.query.branch) {
		commitHash = getCommitHashForBranch(req.query.branch);
    }

    res.writeHead(
        302,
        {
            'Location': assembleSubdomainUrlForHash(req, commitHash)
        }
    );

    res.end();
}

export async function determineCommitHash(req: any, res: any, next: any) {
    const isHashInSession     = !!req.session.commitHash;
    const subdomainCommitHash = getCommitHashFromSubdomain(req);

	if (isHashInSession && !subdomainCommitHash) {
		next();
		return;
	}

    if (!subdomainCommitHash) {
        // @todo Render a nicer page here.
		res.send('Please specify a branch to load');
		return;
	}

	req.session.commitHash = subdomainCommitHash;

    touchCommit(subdomainCommitHash);

	next();
}

export const session = expressSession({
	secret: 'keyboard cat',
	cookie: {},
	resave: false,
	saveUninitialized: true,
});

