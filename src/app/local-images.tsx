import React from 'react';
import ReactDOMServer from 'react-dom/server';
import Docker from 'dockerode';
import { config } from '../config';

import { Shell } from './app-shell';
import { humanSize, humanRelativeTime } from './util';
import { BranchName, CommitHash } from '../api';
import { ONE_MINUTE, ONE_SECOND } from '../constants';

const LocalImages = ( {
	branchHashes,
	knownBranches,
	localImages,
	startedServerAt,
}: RenderContext ) => (
	<Shell
		refreshInterval={ knownBranches.size > 0 ? ONE_MINUTE : 5 * ONE_SECOND }
		startedServerAt={ startedServerAt }
	>
		<style
			dangerouslySetInnerHTML={ {
				__html: `
                .dserve-branch-selector select,
                .dserve-branch-selector input[type="button"] {
                    background: none;
                    color: #fff;
                    font-size: 14px;
                }

                .dserve-branch-selector input[type="button"] {
                    margin-left: 8px;
                    border-radius: 4px;
                }

                .dserve-branch-selector input[type="button"]:hover {
                    background: #fff;
                    color: #222;
                }

                .dserve-image-header {
                    color: #00d8ff;
                }

                .dserve-image-header a {
                    color: #fff;
                    text-decoration: none;
                }

                .dserve-image-header a:hover,
                .dserve-image-header a:visited:hover {
                    color: #00ff0c;
                    text-decoration: underline;
                }

                .dserve-image-header a:visited {
                    color: #fff;
                }

                time {
                    color: #00ff0c;
                }
        `,
			} }
		/>
		<div className="dserve-branch-selector">
			{ knownBranches.size > 0 ? (
				<React.Fragment>
					<select id="selected-branch">
						{ Array.from( knownBranches )
							.sort( ( a, b ) => a[ 0 ].localeCompare( b[ 0 ] ) )
							.map( ( [ branchName, hash ] ) => (
								<option key={ branchName }>{ branchName }</option>
							) ) }
					</select>
					<input id="branch-selector-button" type="button" value="Open" />
					<div
						dangerouslySetInnerHTML={ {
							__html: `
                        <script>
                            (function() {
                                var button = document.getElementById( 'branch-selector-button' );

                                if ( button.getAttribute( 'data-has-listener' ) ) {
                                    return;
                                }

                                button.addEventListener( 'click', function() {
                                    var branch = document.getElementById( 'selected-branch' );

                                    window.open(
                                        '/?branch=' + branch.value,
                                        '_blank'
                                    );
                                } );
                            })();
                        </script>
                    `,
						} }
					/>
				</React.Fragment>
			) : (
				'Loading remote branches…'
			) }
		</div>
		<dl>
			{ Object.keys( localImages ).map( repoTags => {
				const info = localImages[ repoTags ];
				const createdAt = new Date( info.Created * 1000 );
				const match = repoTags.match( new RegExp( `${ config.build.tagPrefix }:([a-f0-9]+)` ) );
				const title =
					match && branchHashes.has( match[ 1 ] ) ? branchHashes.get( match[ 1 ] ) : repoTags;

				return (
					<React.Fragment key={ info.Id }>
						<dt className="dserve-image-header">
							{ title }
							{ match && (
								<React.Fragment>
									{ ' - ' }
									<a href={ `https://github.com/${ config.repo.project }/commit/${ match[ 1 ] }` }>
										Github
									</a>
									{ ' - ' }
									<a href={ `/?hash=${ match[ 1 ] }` } target="_blank">
										Open
									</a>
								</React.Fragment>
							) }
						</dt>
						<dd>
							<p>
								Created{' '}
								{
									<time
										dateTime={ createdAt.toISOString() }
										title={ createdAt.toLocaleTimeString( undefined, {
											timeZoneName: 'long',
											hour12: true,
										} ) }
									>
										{ humanRelativeTime( info.Created ) }
									</time>
								}
							</p>
							<p>ID { info.Id }</p>
							<p>Size { humanSize( info.Size ) }</p>
						</dd>
					</React.Fragment>
				);
			} ) }
		</dl>
	</Shell>
);

type RenderContext = {
	branchHashes: Map< CommitHash, BranchName >;
	knownBranches: Map< BranchName, CommitHash >;
	localImages: { [ s: string ]: Docker.ImageInfo };
	startedServerAt: Date;
};
export default function renderLocalImages( renderContext: RenderContext ) {
	return ReactDOMServer.renderToStaticMarkup( <LocalImages { ...renderContext } /> );
}
