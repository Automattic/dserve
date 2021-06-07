// external
import express from 'express';
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
	getContainerName,
	isValidImage,
	refreshLocalImages,
} from './api';
import { config } from './config';
import { l } from './logger';
import dockerParseImage from 'docker-parse-image';

const containerPattern = /^container-(?<container>[A-Za-z0-9_-]+)\./;

function stripImageHashSubdomainFromHost( host: string ) {
	return host.replace( containerPattern, '' );
}

function assembleSubdomainUrlForContainer( req: express.Request, container: ContainerInfo ) {
	const protocol = req.secure || req.headers.host.indexOf( 'calypso.live' ) > -1 ? 'https' : 'http';

	// Docker names are in the form <string>_<string>, see https://github.com/docker/engine/blob/master/pkg/namesgenerator/names-generator.go#L843
	// But we don't want to generate URLs with `_` because in a few other systems (eg: Calypso, wpcom) we assume the URL will match [a-zA-Z0-9-].calypso.live
	const name = getContainerName( container ).replace( /_/g, '-' );

	const newUrl = new URL(
		`${ protocol }://container-${ name }.${ stripImageHashSubdomainFromHost(
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
	const match = host.match( containerPattern );
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
	res.header( 'Cache-control', 'no-cache' );

	const imageName = req.query.image;
	const environment = req.query.env || config.envs[ 0 ];

	const { registry } = dockerParseImage( imageName );
	if ( ! config.allowedDockerRepositories.includes( registry ) ) {
		res.status( 403 ).send( `The registry ${ registry } is invalid` );
		return;
	}

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
		const image = getAllImages().get( imageName );
		if ( ! isValidImage( image ) ) {
			res.status( 403 ).send( `The image ${ imageName } is not valid` );
			return;
		}

		const container = await createContainer( imageName, environment );
		res.redirect( assembleSubdomainUrlForContainer( req, container ) );
		return;
	}

	// Neither the container nor the image exits. Pull the image, create the container and redirect. If they image is
	// already being pulled, this will "attach" to the output of the existing pull.
	res.status( 202 );
	res.write( '<!DOCTYPE html><body><pre>' );
	await pullImage( imageName, data => {
		res.write( `${ Date.now() } - ${ JSON.stringify( data ) }\n` );
	} );
	await refreshLocalImages();
	const image = getAllImages().get( imageName );
	if ( ! isValidImage( image ) ) {
		res.status( 403 ).send( `The image ${ imageName } is not valid` );
		return;
	}

	const container = await createContainer( imageName, environment );
	const url = assembleSubdomainUrlForContainer( req, container );
	res.write(
		`</pre><script>setTimeout(() => document.location.replace("${ url }"), 5000);</script></body>`
	);
	res.end();
}

/**
 * Gets a container name from the subdmain, starts it if necessary and proxies all requests to it.
 */
async function startAndProxyRequestsToContainer( req: express.Request, res: express.Response ) {
	const containerName: ContainerName = getContainerNameFromSubdomain( req.headers.host );
	let container: ContainerInfo;
	const shouldDelete = 'delete' in req.query;

	container = findContainer( {
		sanitizedName: containerName,
	} );
	if ( ! container ) {
		throw new Error( `Container ${ containerName } not found` );
	}

	if ( shouldDelete ) {
		const containerRealName = getContainerName( container );
		l.log( { containerRealName }, `Hard reset for ${ containerRealName }` );
		await deleteContainer( container );
		res.send( `Container ${ containerRealName } deleted` );
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
 *  - Image in query string (http://calypso.live?<registry>/image=calypso/app:build-4)
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
		startAndProxyRequestsToContainer( req, res ).catch( next );
		return;
	}

	next();
}
