import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';

import { errorClass, humanTime } from './util';

const Log = ({ log }: RenderContext) => (
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
                <ol className="dserve-log-lines">
                { log.split( '\n' ).filter( l => l.length > 0 ).map( ( line, i ) => {
                    let data;
                    try {
                        data = JSON.parse( line );
                    } catch ( e ) {
                        return <li className="dserve-log-line" key={ `${ i }-${ line }` }>Unparseable log item - »<pre>{ line }</pre>«</li>
                    }
                    
                    const at = Date.parse( data.time );

                    return (
                        <li className={ `dserve-log-line ${ errorClass( data.level ) }` } key={ `${ i }-${ line }` }>
                            <time dateTime={ new Date( at ).toISOString() }>{ humanTime( at / 1000 ) }</time> <span>{ data.msg }</span>
                        </li>
                    );
                } ) }
                </ol>
			</div>
		</body>
		<style
			dangerouslySetInnerHTML={{
				__html: `
				.dserve-toolbar:hover {
					background: #ffffff;
					color: #2e4453;
                }

                .dserve-log-lines {
                    list-style: none;
                }
                
                .dserve-log-line {
                    color: #00d8ff;
                    margin-bottom: 4px;
                }

                .dserve-log-line time {
                    color: #eee;
                    display: inline-block;
                    min-width: 6em;
                    text-align: right;
                }

                .dserve-log-line.error span::before {
                    content: ' - 🚨 - ';
                }

                .dserve-log-line.info span::before {
                    content: ' - ℹ - ';
                }
		`,
			}}
		/>
	</html>
);

type RenderContext = { log: string };
export default function renderLog(renderContext: RenderContext) {
	return ReactDOMServer.renderToStaticMarkup(<Log {...renderContext} />);
}
