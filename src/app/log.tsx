import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';

import { Shell } from './app-shell';
import { errorClass, humanTime } from './util';
import { ONE_MINUTE } from '../api';

const Log = ({ log }: RenderContext) => (
    <Shell refreshInterval={ ONE_MINUTE }>
        <style
            dangerouslySetInnerHTML={{
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

                .dserve-log-line.error span::before {
                    content: ' - 🚨 - ';
                }

                .dserve-log-line.info span::before {
                    content: ' - ℹ - ';
                }
        `,
            }}
        />
        <ol className="dserve-log-lines">
        { log.split( '\n' ).filter( l => l.length > 0 ).reverse().map( ( line, i ) => {
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
    </Shell>
);

type RenderContext = { log: string };
export default function renderLog(renderContext: RenderContext) {
	return ReactDOMServer.renderToStaticMarkup(<Log {...renderContext} />);
}
