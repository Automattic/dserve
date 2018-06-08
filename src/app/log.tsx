import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';

import { Shell } from './app-shell';
import { errorClass, humanTime } from './util';
import { ONE_MINUTE } from '../api';

const interestingDetails = new Set([
    'commitHash',
    'freePort',
    'error',
    'err',
    'imageName'
]);

const LogDetails = ( { data  } : any ) => {
    const details = new Map();
    for( let detail of interestingDetails ) {
        if ( data[ detail ] ) {
            details.set( detail, data[ detail ] );
        }
    }
    if ( details.size === 0 ) {
        return null;
    }
    return (
        <div className="details">
            { 
                Array.from( details.entries() ).map( ( [ key, value ] ) => <pre key={key}>{ key }: { typeof value === 'object' ? JSON.stringify( value, null, 2 ) : value.toString() }</pre> )
            }
        </div>
    )
}

const Log = ({ log, startedServerAt }: RenderContext) => (
    <Shell refreshInterval={ ONE_MINUTE } startedServerAt={ startedServerAt }>
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
                    <time
                        dateTime={ new Date( at ).toISOString() }
                        title={ new Date( at ).toLocaleTimeString( undefined, { timeZoneName: 'long', hour12: true } ) }
                    >{ humanTime( at / 1000 ) }</time> <span className="info">{ data.msg }</span>
                    <LogDetails data={ data } />
                </li>
            );
        } ) }
        </ol>
    </Shell>
);

type RenderContext = { log: string, startedServerAt: Date };
export default function renderLog(renderContext: RenderContext) {
	return ReactDOMServer.renderToStaticMarkup(<Log {...renderContext} />);
}
