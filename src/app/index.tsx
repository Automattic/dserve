import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';
import { ONE_SECOND } from '../api';

import { Shell } from './app-shell';
import stripAnsi = require('strip-ansi');

class BuildLog extends React.Component<{ log: string }> {
	render() {
		const { log } = this.props;
		const formattedLog = log
			.trim()
			.split('\n')
			.map(str => {
				try {
					const line = JSON.parse(str);
					return `Time=${line.time} | ${line.msg}`;
				} catch (err) {}
			})
			.map( ( str, i ) => <li key={ i }>{ stripAnsi( str ) }</li> );
		return <ol>{formattedLog}</ol>;
	}
}

const App = ({ buildLog, message }: RenderContext) => (
	<Shell refreshInterval={ 3 * ONE_SECOND }>
		<pre>
			{buildLog && <BuildLog log={buildLog} />}
			{message && <p> {message}</p>}
		</pre>
		<div dangerouslySetInnerHTML={ { __html: `
			<style>
                .dserve-toolbar a {
					transition: background 200ms ease-in;
				}

				@keyframes progress-bar-animation {
						0%   { background-position: 400px 50px; }
						100% {  }
				}
			</style>
		` } } />
	</Shell>
);

type RenderContext = { buildLog?: string; message?: string };
export default function renderApp(renderContext: RenderContext) {
	return ReactDOMServer.renderToStaticNodeStream(<App {...renderContext} />);
}
