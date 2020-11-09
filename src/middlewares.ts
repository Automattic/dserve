// external
import express from 'express';
import expressSession from 'express-session';

// internal
import {
	getCommitHashForBranch,
	refreshRemoteBranches,
	CommitHash,
	touchCommit,
	RunEnv,
} from './api';
import { config } from './config';

const hashPattern = /(?:^|.*?\.)(\w*)-?hash-([a-f0-9]+)\./;

function assembleSubdomainUrlForHash(
	req: express.Request,
	commitHash: CommitHash,
	environment: RunEnv
) {
	const protocol = req.secure || req.headers.host.indexOf( 'calypso.live' ) > -1 ? 'https' : 'http';

	const subdomainEnv = environment && environment !== config.envs[ 0 ] ? environment + '-' : '';

	const newUrl = new URL(
		`${ protocol }://${ subdomainEnv }hash-${ commitHash }.${ stripCommitHashSubdomainFromHost(
			req.headers.host
		) }`
	);
	newUrl.pathname = req.path;
	for ( let [ key, value ] of Object.entries( req.query ) ) {
		if ( key === 'hash' || key === 'branch' || key === 'env' ) {
			continue;
		}
		newUrl.searchParams.set( key, String( value ) );
	}

	return newUrl.toString();
}

function stripCommitHashSubdomainFromHost( host: string ) {
	return host.replace( hashPattern, '' );
}

function getCommitHashFromSubdomain( host: string ) {
	const match = host.match( hashPattern );

	if ( ! match ) {
		return null;
	}

	const [ , , /* full match */ /* environment */ hash ] = match;
	return hash;
}

function getEnvironmentFromSubdomain( host: string ) {
	const match = host.match( hashPattern );

	if ( ! match ) {
		return null;
	}

	const [ , /* full match */ environment ] = match;
	return environment;
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
	const environment = req.query.env;

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

	res.redirect( assembleSubdomainUrlForHash( req, commitHash, environment ) );

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

export function determineEnvironment(
	req: express.Request,
	res: express.Response,
	next: express.NextFunction
) {
	const subdomainEnvironment = getEnvironmentFromSubdomain( req.headers.host );
	if ( config.envs.includes( subdomainEnvironment ) ) {
		req.session.runEnv = subdomainEnvironment;
	} else {
		req.session.runEnv = config.envs[ 0 ];
	}
	next();
}
export const session = expressSession( {
	secret: 'keyboard cat',
	cookie: {},
	resave: false,
	saveUninitialized: true,
} );
