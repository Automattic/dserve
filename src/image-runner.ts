// external
import * as express from 'express';
import { ContainerInfo } from 'dockerode';

// internal
import {
	getAllImages,
	findContainer,
	pullImage,
	deleteContainer,
	ContainerName,
	proxyRequestToContainer,
	reviveContainer,
	createContainer,
} from './api';
import { config } from './config';
import { l, ringbuffer } from './logger';

const imagePattern = /^container-(?<container>\w+)\./;

function stripImageHashSubdomainFromHost( host: string ) {
	return host.replace( imagePattern, '' );
}

function assembleSubdomainUrlForContainer( req: express.Request, container: ContainerInfo ) {
	const protocol = req.secure || req.headers.host.indexOf( 'calypso.live' ) > -1 ? 'https' : 'http';
	const environment = container.Labels[ 'calypsoEnvironment' ];

	const subdomainEnv = environment && environment !== config.envs[ 0 ] ? environment + '-' : '';
	// The first character is a `/`, skip it
	const name = container.Names[ 0 ].substring( 1 );

	const newUrl = new URL(
		`${ protocol }://${ subdomainEnv }container-${ name }.${ stripImageHashSubdomainFromHost(
			req.headers.host
		) }`
	);
	newUrl.pathname = req.path;
	for ( let [ key, value ] of Object.entries( req.query ) ) {
		if ( key === 'hash' || key === 'branch' || key === 'env' || key === 'image' ) {
			continue;
		}
		newUrl.searchParams.set( key, String( value ) );
	}

	return newUrl.toString();
}

function getContainerNameFromSubdomain( host: string ) {
	const match = host.match( imagePattern );
	if ( ! match ) {
		return null;
	}

	return match.groups.container;
}

/**
 * Gets an image name from the query string, finds (or creates) a container for that image
 * and redirects to http://container-<containername>.calypso.live
 */
async function loadImage( req: express.Request, res: express.Response ) {
	const imageName = req.query.image;
	const environment = req.query.env || config.envs[ 0 ];

	// There is a container for this image/environment. Redirect to http://container-<name>.calypso.live
	const existingContainer = findContainer( {
		image: imageName,
		env: environment,
	} );
	if ( existingContainer ) {
		res.redirect( assembleSubdomainUrlForContainer( req, existingContainer ) );
		return;
	}

	// There is no a container for this image, but the image exists in our repo. Create the container and redirect
	if ( getAllImages().has( imageName ) ) {
		const container = await createContainer( imageName, environment );
		res.redirect( assembleSubdomainUrlForContainer( req, container ) );
		return;
	}

	// Neither the container nor the image exits. Pull the image, create the container and redirect. If they image is
	// already being pulled, this will "attach" to the output of the existing pull.
	// TODO: This poor-man's log may cause problems if the client doesn't understand JavaScript, it will never redirect.
	res.write( '<!DOCTYPE html><body><pre>' );
	await pullImage( imageName, data => {
		res.write( `${ Date.now() } - ${ JSON.stringify( data ) }\n` );
	} );
	const container = await createContainer( imageName, environment );
	const url = assembleSubdomainUrlForContainer( req, container );
	res.write(
		`</pre><script>setTimeout(() => document.location.href="${ url }", 5000);</script></body>`
	);
	res.end();
}

/**
 * Gets a container name from the subdmain, starts it if necessary and proxies all requests to it.
 */
async function redirectToContainer( req: express.Request, res: express.Response ) {
	const containerName: ContainerName = getContainerNameFromSubdomain( req.headers.host );
	let container: ContainerInfo;
	const shouldDelete = 'delete' in req.query;

	container = findContainer( {
		name: containerName,
	} );
	if ( ! container ) {
		throw new Error( `Container ${ containerName } not found` );
	}

	if ( shouldDelete ) {
		l.log( { containerName }, `Hard reset for ${ containerName }` );
		await deleteContainer( container );
		res.send( `Container ${ containerName } deleted` );
		return;
	}

	if ( container.State !== 'running' ) {
		container = await reviveContainer( container );
	}

	proxyRequestToContainer( req, res, container );
}

/**
 * Main middleware for the image runner. This single middleware will take care of both cases:
 *
 *  - Image in query string (http://calypso.live?image=registry.a8c.com/calypso/app:build-4)
 *  - Container name in subdomain (http://container-agitated_hypatia.calypso.live/)
 */
export function middleware(
	req: express.Request,
	res: express.Response,
	next: express.NextFunction
) {
	const imageName = req.query && req.query.image;
	if ( imageName ) {
		loadImage( req, res ).catch( next );
		return;
	}

	const containerName = getContainerNameFromSubdomain( req.headers.host );
	if ( containerName ) {
		redirectToContainer( req, res ).catch( next );
		return;
	}

	next();
}
