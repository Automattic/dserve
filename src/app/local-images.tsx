import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';
import * as Docker from 'dockerode';

import { Shell } from './app-shell';
import { humanSize, humanTime } from './util';
import { ONE_MINUTE } from '../api';

const LocalImages = ({ localImages }: RenderContext) => (
    <Shell refreshInterval={ ONE_MINUTE }>
        <dl>
        { Object.keys( localImages ).map( repoTags => {
            const info = localImages[ repoTags ];
            const createdAt = new Date( info.Created * 1000 );
            const match = repoTags.match( /dserve-wpcalypso:([a-f0-9]+)/ );

            return (
                <React.Fragment key={ info.Id }>
                    <dt className="dserve-image-header">
                        { repoTags }{ match && (
                            <React.Fragment>
                                { ' - ' }
                                <a href={ `https://github.com/automattic/wp-calypso/commit/${ match[ 1 ] }` }>Github</a>
                                { ' - ' }
                                <a href={ `/?hash=${ match[ 1 ] }` } target="_blank">Open</a>
                            </React.Fragment>
                        ) }
                    </dt>
                    <dd>
                        <p>Created <time dateTime={ createdAt.toISOString() }>{ humanTime( info.Created ) }</time></p>
                        <p>ID { info.Id }</p>
                        <p>Size { humanSize( info.Size ) }</p>
                    </dd>
                </React.Fragment>
            );
        } ) }
        </dl>
		<style
			dangerouslySetInnerHTML={{
				__html: `
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
			}}
		/>
    </Shell>
);

type RenderContext = { localImages: { [s: string]: Docker.ImageInfo } };
export default function renderLocalImages(renderContext: RenderContext) {
	return ReactDOMServer.renderToStaticMarkup(<LocalImages {...renderContext} />);
}
