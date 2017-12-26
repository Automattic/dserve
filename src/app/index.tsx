import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';
import { ONE_SECOND } from '../api';

class Reloader extends React.Component<{ milliseconds: number }> {
	render() {
		return (
			<div
				dangerouslySetInnerHTML={{
					__html: `
					<script>
						setTimeout(() => window.location.reload(), ${this.props.milliseconds});
					</script>
				`,
				}}
			/>
		);
	}
}

class BuildLog extends React.Component<{ log: string }> {
	render() {
		const { log } = this.props;
		const formattedLog = log
			.split('\n')
			.map(str => {
				const line = JSON.parse(str);
				return `Time=${line.time} | ${line.msg}`;
			})
			.map((str, i) => <li key={i}>{str}</li>);
		return <ol>{formattedLog}</ol>;
	}
}

const App = ({ buildLog, message }: RenderContext) => (
	<html>
		<head />
		<Reloader milliseconds={3 * ONE_SECOND} />
		<body>
			<h1> DServe </h1>
			{buildLog && <BuildLog log={buildLog} />}
			{message && <p> {message}</p>}
		</body>
	</html>
);

type RenderContext = { buildLog?: string; message?: string };
export default function renderApp(renderContext: RenderContext) {
	return ReactDOMServer.renderToStaticNodeStream(<App {...renderContext} />);
}
