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
import {ImageNotFound, InvalidImage, InvalidRegistry} from './error';

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
		throw new InvalidRegistry(registry)
	}

	// Check if there is a container for this image+environment
	const existingContainer = findContainer( {
		image: imageName,
		env: environment,
	} );
	if ( existingContainer ) {
		// Redirect to http://container-<name>.calypso.live
		res.redirect( assembleSubdomainUrlForContainer( req, existingContainer ) );
		return;
	}

	// There is no container. Check if we have the image already downloaded
	const image = getAllImages().get( imageName );
	if (!image) {
		// No image in local repo, try to fetch it and reload the page when it's done.
		try{
			let responseStarted = false;
			await pullImage( imageName, data => {
				// This callback is called when the image starts to download. At this point we know the image exists.
				// Start streaming the download logs.
				if (!responseStarted) {
					res.status( 202 ).write( '<!DOCTYPE html><body><pre>' );
					responseStarted=true;
				}
				res.write( `${ Date.now() } - ${ JSON.stringify( data ) }\n` );
			} );

			// After the imge is pulled, reload the page. This will invoke this same express handler, but now that the
			// image has been downloaded it will follow a different code path
			res.write( `</pre><script>document.location.reload()</script></body>` );
			res.end();
			return;
		}catch(err) {
			if (err.message.match(/HTTP code 404/)) {
				throw new ImageNotFound(imageName)
			} else {
				throw err;
			}
		}
	}

	// We have the image! Validate it (i.e. validate it was built with TeamCity)
	if ( ! isValidImage( image ) ) {
		throw new InvalidImage(imageName)
	}

	// The image is valid, create the container and redirect to http://container-<name>.calypso.live
	const container = await createContainer( imageName, environment );
	res.redirect( assembleSubdomainUrlForContainer( req, container ) );
	return;
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
