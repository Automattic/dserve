// external
import * as express from 'express';
import * as expressSession from 'express-session';

// internal
import {
	getCommitHashForBranch,
	refreshRemoteBranches,
	CommitHash,
	touchCommit,
	ONE_MINUTE,
} from './api';
import { RSA_NO_PADDING } from 'constants';

const hashPattern = /(?:^|.*?\.)hash-([a-f0-9]+)\./;

function assembleSubdomainUrlForHash( req: express.Request, commitHash: CommitHash ) {
	const protocol = req.secure || req.headers.host.indexOf( 'calypso.live' ) > -1 ? 'https' : 'http';

	return (
		protocol +
		'://hash-' +
		commitHash +
		'.' +
		stripCommitHashSubdomainFromHost( req.headers.host ) +
		req.path
	);
}

function stripCommitHashSubdomainFromHost( host: string ) {
	return host.replace( hashPattern, '' );
}

function getCommitHashFromSubdomain( host: string ) {
	const match = host.match( hashPattern );

	if ( ! match ) {
		return null;
	}

	const [ , /* full match */ hash ] = match;
	return hash;
}

export function redirectHashFromQueryStringToSubdomain(
	req: express.Request,
	res: express.Response,
	next: express.NextFunction,
	retry: number = 2
) {
	const isHashSpecified = req.query && ( req.query.hash || req.query.branch );

	if ( ! isHashSpecified ) {
		next();
		return;
	}

	const commitHash = req.query.hash || getCommitHashForBranch( req.query.branch );

	const sendError = () => {
		res.send( 'could not find a hash for that branch' );
		res.end();
	};

	if ( ! commitHash ) {
		// could not find a hash for the branch... refresh the remotes and try again
		if ( retry > 0 ) {
			refreshRemoteBranches()
				.then( () => {
					redirectHashFromQueryStringToSubdomain( req, res, next, retry - 1 );
				} )
				.catch( sendError );
			return;
		}
		sendError();
	}

	res.redirect( assembleSubdomainUrlForHash( req, commitHash ) );

	res.end();
}

export function determineCommitHash(
	req: express.Request,
	res: express.Response,
	next: express.NextFunction
) {
	const isHashInSession = !! req.session.commitHash;
	const subdomainCommitHash = getCommitHashFromSubdomain( req.headers.host );

	if ( isHashInSession && ! subdomainCommitHash ) {
		next();
		return;
	}

	if ( ! subdomainCommitHash ) {
		// @todo Render a nicer page here.
		res.send( 'Please specify a branch to load' );
		return;
	}

	req.session.commitHash = subdomainCommitHash;

	touchCommit( subdomainCommitHash );

	next();
}

export const session = expressSession( {
	secret: 'keyboard cat',
	cookie: {},
	resave: false,
	saveUninitialized: true,
} );
