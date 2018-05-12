import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';
import * as Docker from 'dockerode';

import { humanSize, humanTime } from './util';

const LocalImages = ({ localImages }: RenderContext) => (
	<html>
		<head />
		<body
			style={{
				fontFamily:
					'-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen-Sans", "Ubuntu", "Cantarell", "Helvetica Neue", sans-serif',
				background: '#091e25',
				color: '#ffffff',
				margin: '0',
			}}
		>
			<div
				className="dserve-message"
				style={{
					position: 'fixed',
					width: '100%',
					boxSizing: 'border-box',
					minHeight: 55,
					maxHeight: 80,
					overflow: 'hidden',
					padding: '16px 20px',
					margin: 0,
					background: '#2e4453',
					color: '#ffffff',
					backgroundImage:
						'linear-gradient( -45deg, #3d596d 28%, #334b5c 28%, #334b5c 72%, #3d596d 72%)',
					backgroundSize: '200px 100%',
					backgroundRepeat: 'repeat-x',
					backgroundPosition: '0 50px',
				}}
			>
				DServe Calypso
				<div
					className="dserve-toolbar"
					style={{
						position: 'absolute',
						top: 12,
						right: 4,
						boxSizing: 'border-box',
						display: 'flex',
					}}
				>
					<a
						href="https://github.com/Automattic/dserve/issues"
						style={{
							display: 'inline-block',
							border: '1px solid #ffffff',
							borderRadius: 3,
							padding: '4px 6px',
							margin: '0 10px 0 0',
							fontSize: 12,
							textDecoration: 'none',
							color: '#ffffff',
							background: '#2e4453',
							transition: 'all 200ms ease-in',
						}}
					>
						Report issues
					</a>
				</div>
			</div>
			<div
				style={{
					boxSizing: 'border-box',
					width: '100%',
					border: 0,
					padding: '86px 20px 10px 20px',
				}}
			>
                <dl>
                { Object.keys( localImages ).map( repoTags => {
                    const info = localImages[ repoTags ];
                    const createdAt = new Date( info.Created * 1000 );
                    const title = /dserve-wpcalypso:[a-f0-9]+/.test( repoTags )
                        ? <a href={ `https://github.com/Automattic/wp-calypso/commit/${ repoTags.split( ':' )[ 1 ] }` }>{ repoTags }</a>
                        : repoTags;

                    return (
                        <React.Fragment key={ info.Id }>
                            <dt className="dserve-image-header">{ title }</dt>
                            <dd>
                                <p>Created <time dateTime={ createdAt.toISOString() }>{ humanTime( info.Created ) }</time></p>
                                <p>ID { info.Id }</p>
                                <p>Size { humanSize( info.Size ) }</p>
                            </dd>
                        </React.Fragment>
                    );
                } ) }
                </dl>
			</div>
		</body>
		<style
			dangerouslySetInnerHTML={{
				__html: `
				.dserve-toolbar:hover {
					background: #ffffff;
					color: #2e4453;
				}
                
                .dserve-image-header {
                    color: #00d8ff;
                }

                .dserve-image-header a {
                    color: #00d8ff;
                    text-decoration: none;
                }

                .dserve-image-header a:hover {
                    text-decoration: underline;
                }

                .dserve-image-header a:visited {
                    color: #00d8ff;
                }

                time {
                    color: #00ff0c;
                }
		`,
			}}
		/>
	</html>
);

type RenderContext = { localImages: { [s: string]: Docker.ImageInfo } };
export default function renderLocalImages(renderContext: RenderContext) {
	return ReactDOMServer.renderToStaticMarkup(<LocalImages {...renderContext} />);
}
