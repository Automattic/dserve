// external
import * as express from 'express';
import * as fs from 'fs-extra';
import * as striptags from 'striptags';
import * as useragent from 'useragent';
import { exec } from 'child_process';

// internal
import {
	getCommitHashForBranch,
	getKnownBranches,
	hasHashLocally,
	CommitHash,
	NotFound,
	getPortForContainer,
	startContainer,
	isContainerRunning,
	proxyRequestToHash as proxy,
	deleteImage,
	getLocalImages,
	getBranchHashes,
} from './api';

import { ONE_MINUTE, ONE_SECOND } from './constants';

import {
	isBuildInProgress,
	buildImageForHash,
	readBuildLog,
	addToBuildQueue,
	cleanupBuildDir,
} from './builder';

import {
	redirectHashFromQueryStringToSubdomain,
	determineCommitHash,
	session,
} from './middlewares';

import renderApp from './app/index';
import renderLocalImages from './app/local-images';
import renderLog from './app/log';
import renderDebug from './app/debug';
import { l, ringbuffer } from './logger';
import { increment } from './stats';
import { Writable } from 'stream';

import {
	refreshLocalImages,
	refreshRemoteBranches,
	refreshRunningContainers,
	cleanupExpiredContainers,
} from './api';

const startedServerAt = new Date();
increment( 'server_start' );

// calypso proxy server.
// checks branch names, decides to start a build or a container,
// and also proxies request to currently active container
const calypsoServer = express();
calypsoServer.use( session );

// global node process junk - catched unhandled errors
process.on( 'uncaughtException', error => {
	l.log( { error }, 'Crashing on uncaught error' );
	increment( 'uncaught_error' );
} );

export const promiseRejections: Map<
	Promise< any >,
	[Date, any, 'reported' | 'unreported']
> = new Map();
const logRejections = () => {
	const now = new Date();
	Array.from( promiseRejections.entries() )
		.filter(
			( [ , [ ts, , status ] ] ) =>
				'unreported' === status && now.getTime() - ts.getTime() > ONE_MINUTE
		)
		.forEach( ( [ promise, [ ts, reason ] ] ) => {
			l.log( { reason }, 'Unhandled rejection sitting in queue for at least one minute' );
			promiseRejections.set( promise, [ ts, reason, 'reported' ] );
		} );

	setTimeout( logRejections, ONE_MINUTE );
};
process.on( 'unhandledRejection', ( reason, promise ) => {
	promiseRejections.set( promise, [ new Date(), reason, 'unreported' ] );
	increment( 'unhandled_promise_rejection' );
} );
process.on( 'rejectionHandled', promise => promiseRejections.delete( promise ) );
logRejections();

// get application log for debugging
calypsoServer.get( '/log', ( req: express.Request, res: express.Response ) => {
	isBrowser( req )
		? res.send( renderLog( { log: ringbuffer.records, startedServerAt } ) )
		: res.send( ringbuffer.records );
} );

calypsoServer.get( '/localimages', ( req: express.Request, res: express.Response ) => {
	const branchHashes = getBranchHashes();
	const knownBranches = getKnownBranches();
	const localImages = Array.from( getLocalImages() ).reduce(
		( images, [ repoTags, image ] ) => ( { ...images, [ repoTags ]: image } ),
		{}
	);

	isBrowser( req )
		? res.send(
				renderLocalImages( {
					branchHashes,
					knownBranches,
					localImages,
					startedServerAt,
				} )
		  )
		: res.send( JSON.stringify( localImages ) );
} );

calypsoServer.get( '/debug', async ( req: express.Request, res: express.Response ) => {
	res.send(
		await renderDebug( {
			startedServerAt,
		} )
	);
} );

calypsoServer.use( redirectHashFromQueryStringToSubdomain );
calypsoServer.use( determineCommitHash );

calypsoServer.get( '/status', async ( req: express.Request, res: express.Response ) => {
	const commitHash = req.session.commitHash;
	let status;
	if ( isContainerRunning( commitHash ) ) {
		status = 'Ready';
	} else if ( await hasHashLocally( commitHash ) ) {
		status = 'NeedsPriming';
	} else if ( await isBuildInProgress( commitHash ) ) {
		status = 'Building';
	} else {
		status = 'NotBuilt';
	}
	res.send( status );
	res.end();
} );

calypsoServer.get( '*', async ( req: express.Request, res: express.Response ) => {
	const commitHash = req.session.commitHash;
	const hasLocally = await hasHashLocally( commitHash );
	const isCurrentlyBuilding = ! hasLocally && ( await isBuildInProgress( commitHash ) );
	const needsToBuild = ! isCurrentlyBuilding && ! hasLocally;
	const shouldStartContainer = hasLocally && ! isContainerRunning( commitHash );
	const shouldReset = req.query.reset;

	if ( shouldReset ) {
		l.log( { commitHash }, `Hard reset for ${ commitHash }` );
		increment( 'hash_reset' );
		await deleteImage( commitHash );
		await cleanupBuildDir( commitHash );
		const response = `hard reset hash: ${ commitHash } and loading it now...`;
		res.set( 'Refresh', `5;url=${ req.path }` );
		res.send( striptags( response ) );
		return;
	}

	if ( isContainerRunning( commitHash ) ) {
		proxy( req, res );
		return;
	}

	let buildLog;
	let message;
	if ( isCurrentlyBuilding ) {
		buildLog = await readBuildLog( commitHash );
	} else if ( needsToBuild ) {
		message = 'Starting build now';
		addToBuildQueue( commitHash );
	} else if ( shouldStartContainer ) {
		//message = 'Just started your hash, this page will restart automatically';
		// TODO: fix race condition where multiple containers may be spun up
		// within the same subsecond time period.
		try {
			await startContainer( commitHash );
			proxy( req, res );
			return;
		} catch ( err ) {
			message = 'Error starting that commit...';
			l.error( { err }, 'Error starting commit' );
		}
	}

	renderApp( { message, buildLog, startedServerAt } ).pipe( res );
} );

// log errors
calypsoServer.use(
	( err: any, req: express.Request, res: express.Response, next: express.NextFunction ) => {
		if ( err ) {
			l.error( err, `Error serving request for ${ req.originalUrl }` );
		}
		next( err );
	}
);

const server = calypsoServer.listen( 3000, () =>
	l.log(
		`✅ dserve is listening on 3000 - started at ${ startedServerAt.toLocaleTimeString( undefined, {
			timeZoneName: 'long',
			hour12: true,
		} ) }`
	)
);

server.on( 'error', err => {
	console.log( 'err' );
	l.error( err, 'Error serving request' );
} );
server.on( 'close', () => {
	console.log( 'close' );
	l.log( {}, 'Server shutting down' );
} );

function isBrowser( req: express.Request ): Boolean {
	const ua = useragent.lookup( req.header( 'user-agent' ) );
	const family = ua.family.toLocaleLowerCase();

	return (
		family === 'chrome' ||
		family === 'safari' ||
		family === 'firefox' ||
		family === 'chrome mobile' ||
		family === 'mobile safari'
	);
}

if ( process.env.NODE_ENV !== 'test' ) {
	const loop = ( f: Function, delay: number ) => {
		const run = async () => {
			try {
				await f();
			} catch ( e ) {
				l.error( e );
			} finally {
				setTimeout( run, delay );
			}
		};

		run();
	};

	loop( refreshLocalImages, 5 * ONE_SECOND );
	loop( refreshRunningContainers, 5 * ONE_SECOND );
	loop( refreshRemoteBranches, ONE_MINUTE );
	// Wait a bit before starting the expired container cleanup.
	// This gives us some time to accumulate accesses to existing containers across app restarts
	setTimeout( () => loop( cleanupExpiredContainers, ONE_MINUTE ), 2 * ONE_MINUTE );
}
