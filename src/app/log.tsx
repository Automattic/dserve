import React from 'react';
import ReactDOMServer from 'react-dom/server';

import { Shell } from './app-shell';
import { errorClass, humanRelativeTime } from './util';
import { ONE_MINUTE } from '../constants';
import LogDetails from './log-details';

const Log = ( { log, startedServerAt }: RenderContext ) => {
	return (
		<Shell refreshInterval={ ONE_MINUTE } startedServerAt={ startedServerAt }>
			<style
				dangerouslySetInnerHTML={ {
					__html: `
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

                .dserve-log-line.error span.info::before {
                    content: ' - 🚨 - ';
                }

                .dserve-log-line.info span.info::before {
                    content: ' - ℹ - ';
                }

                .dserve-log-line .details {
                    font-family: monospace;
                    color: #999;
                    margin-left: 15em;
                }

                .dserve-log-line .details pre {
                    margin: 0;
                }

                .dserve-log-line a[href] {
                  color: lightblue;
                }
        `,
				} }
			/>
			<ol className="dserve-log-lines">
				{ log
					.map( ( data, i ) => {
						const at = Date.parse( data.time );

						return (
							<li className={ `dserve-log-line ${ errorClass( data.level ) }` } key={ `${ i }` }>
								<time
									dateTime={ new Date( at ).toISOString() }
									title={ new Date( at ).toLocaleTimeString( undefined, {
										timeZoneName: 'long',
										hour12: true,
									} ) }
								>
									{ humanRelativeTime( at / 1000 ) }
								</time>{' '}
								<span className="info">{ data.msg }</span>
								<LogDetails data={ data } />
							</li>
						);
					} )
					.reverse() }
			</ol>
		</Shell>
	);
};

type RenderContext = { log: any[]; startedServerAt: Date };
export default function renderLog( renderContext: RenderContext ) {
	return ReactDOMServer.renderToStaticMarkup( <Log { ...renderContext } /> );
}
