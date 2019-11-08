import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';
import * as Dockerode from 'dockerode';
import * as os from 'os';

import { ONE_MINUTE } from '../constants';
import { Shell } from './app-shell';
import { promiseRejections } from '../index';
import { humanSize, humanRelativeTime, percent, round } from './util';

import { state as apiState, getCommitAccessTime, extractCommitFromImage } from '../api';
import { buildQueue, pendingHashes } from '../builder';

const Docker = new Dockerode();

async function maxTime( p: Promise< any >, timeoutMs: number ) {
	const timeout = new Promise( ( resolve, reject ) => {
		setTimeout( () => reject( 'timeout' ), timeoutMs );
	} );
	return Promise.race( [ p, timeout ] );
}

const Debug = ( c: RenderContext ) => {
	const memUsage = process.memoryUsage();
	const heapU = memUsage.heapUsed;
	const heapT = memUsage.heapTotal;
	const memTotal = os.totalmem();
	const memUsed = memTotal - os.freemem();
	const images = Array.from( apiState.localImages.entries() ) as Array<
		[ string, Dockerode.ImageInfo ]
	>;
	const apiContainers = Array.from( apiState.containers.entries() );

	const shortHash = ( hash: string = '', length = 30 ) => (
		<span title={ hash }>{ hash.slice( 0, length ) }…</span>
	);

	return (
		<Shell refreshInterval={ ONE_MINUTE } startedServerAt={ c.startedServerAt }>
			<style
				dangerouslySetInnerHTML={ {
					__html: `
                    .dserve-debug-cards {
                        display: grid;
                        grid-template-columns: repeat(6, 1fr);
                        grid-gap: 10px;
                        grid-auto-rows: minmax(100px, auto);
                    }

                    .dserve-debug-cards figure {
                        border: 1px solid gray;
                        border-radius: 4px;
                        padding: 8px;
                        position: relative;
                    }

                    .system {
                        grid-row: 1;
                        grid-column: 1 / 3;
                    }

                    .queue {
                        grid-row: 1;
                        grid-column: 3 / 5;
                    }

                    .promises {
                        grid-row: 1;
                        grid-column: 5 / 7;
                    }

                    .api {
                        grid-row: 2;
                        grid-column: 1 / 4;
                    }

                    .docker {
                        grid-row: 2;
                        grid-column: 4 / 7;
                    }

                    .dserve-debug-cards figure figcaption {
                        border: 1px solid gray;
                        border-radius: 2px;
                        padding: 4px;
                        position: absolute;
                        top: 2px;
                        right: 2px;
                    }

                    .dserve-debug-cards a[href] {
                        color: #00d8ff;
                    }

                    .dserve-container-list li ,
                    .dserve-image-list li {
                        margin-bottom: 8px;
                    }

                    .dserve-container-list li.created strong:before {
                        content: '🈺 ';
                    }

                    .dserve-container-list li.exited strong:before {
                        content: '🈵 ';
                    }

                    .dserve-container-list li.running strong:before {
                        content: '✅ ';
                    }`,
				} }
			/>
			<div className="dserve-debug-cards">
				<figure className="system">
					<p>
						CPU (x{ os.cpus().length }):{' '}
						{ os
							.loadavg()
							.map( a => round( a, 2 ) )
							.join( ', ' ) }{' '}
						(1m, 5m, 15m)
					</p>
					<p>Memory</p>
					<ul>
						<li>
							heap: { humanSize( heapU ) } / { humanSize( heapT ) } ({ percent( heapU, heapT ) }%)
						</li>
						<li>
							system: { humanSize( memUsed ) } / { humanSize( memTotal ) } (
							{ percent( memUsed, memTotal ) }%)
						</li>
					</ul>
					<figcaption>System Load</figcaption>
				</figure>

				<figure className="queue">
					<p>Building</p>
					{ pendingHashes.size ? (
						<ul>
							{ Array.from( pendingHashes ).map( hash => (
								<li key={ hash }>
									<a href={ `/?hash=${ hash }` }>{ hash.substr( 0, 8 ) }</a>{' '}
									<a href={ `https://github.com/Automattic/wp-calypso/commit/${ hash }` }>github</a>
								</li>
							) ) }
						</ul>
					) : (
						<p>
							<em>Nothing building</em>
						</p>
					) }
					<p>Queue</p>
					{ buildQueue.length ? (
						<ul>
							{ buildQueue.map( hash => (
								<li key={ hash }>
									<a href={ `/?hash=${ hash }` }>{ hash.substr( 0, 8 ) }</a>{' '}
									<a href={ `https://github.com/Automattic/wp-calypso/commit/${ hash }` }>github</a>
								</li>
							) ) }
						</ul>
					) : (
						<p>
							<em>Nothing queued</em>
						</p>
					) }
					<figcaption>Builder</figcaption>
				</figure>

				<figure className="promises">
					{ promiseRejections.size ? (
						<ul>
							{ Array.from( promiseRejections.values() ).map( ( [ ts, reason ], i ) => (
								<li key={ i }>
									<time
										dateTime={ ts.toISOString() }
										title={ ts.toLocaleTimeString( undefined, {
											timeZoneName: 'long',
											hour12: true,
										} ) }
									>
										{ humanRelativeTime( ts.getTime() / 1000 ) }
									</time>{' '}
									{ reason.toString() }
								</li>
							) ) }
						</ul>
					) : (
						<p>
							<em>No unhandled rejected promises</em>
						</p>
					) }
					<figcaption>Rejected Promises</figcaption>
				</figure>

				<figure className="api">
					<p>Running Containers</p>
					<ul>
						{ apiContainers.length === 0 ? (
							<li>
								<em>No running containers</em>
							</li>
						) : (
							apiContainers.map( ( [ key, info ] ) => {
								const commit = extractCommitFromImage( info.Image );
								return (
									<li key={ info.Id } className={ info.State }>
										<strong>{ info.Names }</strong> - { shortHash( info.Id ) }
										<br />
										Commit: { commit ? <a href={ `/?hash=${ commit }` }>{ commit }</a> : 'none' }
										<br />
										Image ID: { shortHash( info.ImageID ) }
										<br />
										Status: { info.Status }
										<br />
										Last Access:{' '}
										{ getCommitAccessTime( commit )
											? humanRelativeTime( getCommitAccessTime( commit ) / 1000 )
											: 'never' }
									</li>
								);
							} )
						) }
					</ul>

					<p>DServe Images</p>
					<p>
						Total storage size:{' '}
						{ humanSize( images.reduce( ( size, [ , info ] ) => size + info.Size, 0 ) ) }
					</p>
					<ul>
						{ images.length === 0 ? (
							<li>
								<em>No dserve images</em>
							</li>
						) : (
							images.map( ( [ key, info ] ) => (
								<li key={ info.Id }>
									Commit:{' '}
									<strong>
										{ info.RepoTags ? (
											<a href={ `/?hash=${ extractCommitFromImage( info.RepoTags.join( ' ' ) ) }` }>
												{ extractCommitFromImage( info.RepoTags.join( ' ' ) ) }{' '}
											</a>
										) : (
											'None'
										) }
									</strong>
									<br />
									Id: { shortHash( info.Id ) }
									<br />
									Size: { humanSize( info.Size ) }
									<br />
									Created: { humanRelativeTime( info.Created ) }
								</li>
							) )
						) }
					</ul>

					<figcaption>API</figcaption>
				</figure>

				<figure className="docker">
					<p>All Containers</p>
					<ul className="dserve-container-list">
						{ c.docker.containers.length === 0 ? (
							<li>
								<em>No containers</em>
							</li>
						) : (
							c.docker.containers
								.sort( ( a, b ) => b.Created - a.Created )
								.map( info => (
									<li key={ info.Id } className={ info.State }>
										<strong>{ info.Names }</strong> - { shortHash( info.Id ) }
										<br />
										Image ID: { shortHash( info.ImageID ) }
										<br />
										Status: { info.State } - { info.Status }
									</li>
								) )
						) }
					</ul>

					<p>All Images</p>
					<ul className="dserve-image-list">
						{ c.docker.images.length === 0 ? (
							<li>
								<em>No docker images</em>
							</li>
						) : (
							c.docker.images
								.sort( ( a, b ) => b.Created - a.Created )
								.map( info => (
									<li key={ info.Id }>
										RepoTags:{' '}
										<strong>
											{ info.RepoTags ? shortHash( info.RepoTags.join( ', ' ), 38 ) : 'None' }
										</strong>
										<br />
										Id: { shortHash( info.Id ) }
										<br />
										Size: { humanSize( info.Size ) }
										<br />
										Created: { humanRelativeTime( info.Created ) }
									</li>
								) )
						) }
					</ul>
					<figcaption>Docker</figcaption>
				</figure>
			</div>
		</Shell>
	);
};

type RenderContext = {
	startedServerAt: Date;
	docker: {
		containers: Array< Dockerode.ContainerInfo >;
		images: Array< Dockerode.ImageInfo >;
	};
};

export default async function renderDebug( { startedServerAt }: { startedServerAt: Date } ) {
	let containers, images;
	try {
		containers = await maxTime( Docker.listContainers( { all: true } ), 5000 );
	} catch ( err ) {
		containers = [];
	}
	try {
		images = await maxTime( Docker.listImages(), 5000 );
	} catch ( err ) {
		images = [];
	}
	return ReactDOMServer.renderToStaticMarkup(
		<Debug
			startedServerAt={ startedServerAt }
			docker={ {
				containers,
				images,
			} }
		/>
	);
}
