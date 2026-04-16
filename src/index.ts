// external
import express from 'express';
import fs from 'fs-extra';
import striptags from 'striptags';
import useragent from 'useragent';
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
	isContainerReadyToServe,
	proxyRequestToHash as proxy,
	deleteImage,
	getLocalImages,
	getBranchHashes,
} from './api';
import { decideRouteAction } from './route-actions';

import { ONE_MINUTE, ONE_SECOND, TEN_MINUTES } from './constants';

import {
	isBuildInProgress,
	buildImageForHash,
	readBuildLog,
	addToBuildQueue,
	cleanupBuildDir,
	buildQueue,
	didBuildFail,
} from './builder';

import {
	redirectHashFromQueryStringToSubdomain,
	determineCommitHash,
	session,
	determineEnvironment,
} from './middlewares';
import { middleware as imageRunnerMiddleware } from './image-runner';
import renderApp from './app/index';
import renderLocalImages from './app/local-images';
import renderLog from './app/log';
import renderDebug from './app/debug';
import { l, ringbuffer } from './logger';
import { increment } from './stats';

import {
	refreshLocalImages,
	refreshRemoteBranches,
	refreshContainers,
	cleanupExpiredContainers,
	getDockerDiagnostics,
} from './api';
import { ContainerError, ImageError, ImageNotFound, InvalidImage, InvalidRegistry } from './error';

const startedServerAt = new Date();
increment( 'server_start' );

async function logDockerStartupDiagnostics() {
	try {
		const diagnostics = await getDockerDiagnostics();
		l.info( { docker: diagnostics }, 'Docker startup diagnostics' );

		if ( diagnostics.buildBackend !== 'buildkit' ) {
			l.warn(
				{ docker: diagnostics },
				'Docker daemon is not advertising BuildKit as the default builder; some Calypso Dockerfiles may fail'
			);
		}
	} catch ( err ) {
		l.warn( { err }, 'Could not query Docker startup diagnostics' );
	}
}

// calypso proxy server.
// checks branch names, decides to start a build or a container,
// and also proxies request to currently active container
const calypsoServer = express();
calypsoServer.use( session );

// global node process junk - catched unhandled errors
process.on( 'uncaughtException', error => {
	l.info( { error }, 'Crashing on uncaught error' );
	increment( 'uncaught_error' );
} );

export const promiseRejections: Map<
	Promise< any >,
	[ Date, any, 'reported' | 'unreported' ]
> = new Map();
const logRejections = () => {
	const now = new Date();
	Array.from( promiseRejections.entries() )
		.filter(
			( [ , [ ts, , status ] ] ) =>
				'unreported' === status && now.getTime() - ts.getTime() > ONE_MINUTE
		)
		.forEach( ( [ promise, [ ts, reason ] ] ) => {
			l.info( { reason }, 'Unhandled rejection sitting in queue for at least one minute' );
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

calypsoServer.get( '/api/queue-size', ( req: express.Request, res: express.Response ) => {
	res.contentType( 'text/plain' );
	res.send( '' + buildQueue.length );
	res.end();
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
	try {
		res.send(
			await renderDebug( {
				startedServerAt,
			} )
		);
	} catch ( err ) {
		l.error( { err }, 'Error rendering debug' );
		res.send( 'error rendering debug' );
		res.end();
	}
} );

calypsoServer.use( imageRunnerMiddleware );
calypsoServer.use( redirectHashFromQueryStringToSubdomain );
calypsoServer.use( determineCommitHash );
calypsoServer.use( determineEnvironment );

calypsoServer.get( '/status', async ( req: express.Request, res: express.Response ) => {
	const commitHash = req.session.commitHash;
	let status;
	if ( isContainerReadyToServe( commitHash ) ) {
		status = 'Ready';
	} else if ( isContainerRunning( commitHash ) ) {
		status = 'Starting';
	} else if ( didBuildFail( commitHash ) ) {
		status = 'FAIL';
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
	const { commitHash, runEnv } = req.session;
	const hasLocally = await hasHashLocally( commitHash );
	const isCurrentlyBuilding = ! hasLocally && ( await isBuildInProgress( commitHash ) );
	const isRunning = isContainerRunning( commitHash, runEnv );
	const isHealthy = isContainerReadyToServe( commitHash, runEnv );
	const shouldReset = Boolean( req.query.reset );
	const acceptsHtml = ( req.header( 'accept' ) || '' ).includes( 'text/html' );

	const action = decideRouteAction( {
		commitHash,
		runEnv: runEnv || '',
		hasLocally,
		isCurrentlyBuilding,
		isRunning,
		isHealthy,
		didFail: didBuildFail( commitHash ),
		shouldReset,
		acceptsHtml,
	} );

	switch ( action.kind ) {
		case 'reset': {
			l.info( { commitHash }, `Hard reset for ${ commitHash }` );
			increment( 'hash_reset' );
			await deleteImage( commitHash );
			await cleanupBuildDir( commitHash );
			res.set( 'Refresh', `5;url=${ req.path }` );
			res.send( striptags( `hard reset hash: ${ commitHash } and loading it now...` ) );
			return;
		}
		case 'proxy': {
			proxy( req, res );
			return;
		}
		case 'loading': {
			res.set( 'Refresh', `2;url=${ req.path }` );
			renderApp( { message: action.message, startedServerAt } ).pipe( res );
			return;
		}
		case 'not-ready': {
			res.set( 'Retry-After', '2' );
			res.status( 503 ).send( 'Container not ready' );
			return;
		}
		case 'show-build-log': {
			const buildLog = await readBuildLog( commitHash );
			renderApp( { buildLog, startedServerAt } ).pipe( res );
			return;
		}
		case 'enqueue-build': {
			addToBuildQueue( commitHash );
			renderApp( { message: 'Starting build now', startedServerAt } ).pipe( res );
			return;
		}
		case 'start-container': {
			try {
				await startContainer( commitHash, runEnv );
				res.set( 'Refresh', `1;url=${ req.path }` );
				res.send( striptags( 'build complete, loading now...' ) );
			} catch ( err ) {
				l.error( { err }, 'Error starting commit' );
				renderApp( {
					message: 'Error starting that commit...',
					startedServerAt,
				} ).pipe( res );
			}
			return;
		}
	}
} );

// log errors
calypsoServer.use(
	( err: Error, req: express.Request, res: express.Response, next: express.NextFunction ) => {

		if (err instanceof ImageNotFound) {
			l.warn( {err, url:req.originalUrl, image:err.name});
			res.status(404).send(`Image ${err.name} not found`);
			return;
		}

		if (err instanceof InvalidImage) {
			l.warn( {err, url:req.originalUrl, image:err.name});
			res.status(403).send(err.message);
			return;
		}

		if (err instanceof InvalidRegistry) {
			l.warn( {err, url:req.originalUrl, registry:err.registry});
			res.status(403).send(`Registry ${err.registry} is not valid`);
			return;
		}

		if (err instanceof ContainerError) {
			l.error( {err, url:req.originalUrl, containerName: err.containerName});
			res.status(500).send(err.message);
			return;
		}

		if (err instanceof ImageError) {
			l.error( {err, url:req.originalUrl, imageName: err.imageName});
			res.status(500).send(err.message);
			return;
		}

		// Catch all for unknown errors
		l.error(err);
		res.status(500).send(err.message);
	}
);

const server = calypsoServer.listen( 3000, () =>
	l.info(
		`✅ dserve is listening on 3000 - node ${ process.version } - started at ${ startedServerAt.toLocaleTimeString( undefined, {
			timeZoneName: 'long',
			hour12: true,
		} ) }`
	)
);

const dockerodeVersion = require('dockerode/package.json').version;
const modemVersion = require('docker-modem/package.json').version;
l.info({ data: { dockerodeVersion, modemVersion }}, 'Dockerode library versions');
logDockerStartupDiagnostics();

server.on( 'error', err => {
	console.log( 'err' );
	l.error( err, 'Error serving request' );
} );
server.on( 'close', () => {
	console.log( 'close' );
	l.info( {}, 'Server shutting down' );
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
	loop( refreshContainers, 5 * ONE_SECOND );
	loop( refreshRemoteBranches, ONE_MINUTE );
	// Wait a bit before starting the expired container cleanup.
	// This gives us some time to accumulate accesses to existing containers across app restarts
	setTimeout( () => loop( cleanupExpiredContainers, ONE_MINUTE ), TEN_MINUTES );
}
