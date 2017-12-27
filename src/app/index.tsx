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
			.trim()
			.split('\n')
			.map(str => {
				try {
					const line = JSON.parse(str);
					return `Time=${line.time} | ${line.msg}`;
				} catch (err) {}
			})
			.map((str, i) => <li key={i}>{str}</li>);
		return <ol>{formattedLog}</ol>;
	}
}

const App = ({ buildLog, message }: RenderContext) => (
	<html>
		<head />
		<Reloader milliseconds={3 * ONE_SECOND} />
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
					animation: 'progress-bar-animation 3300ms infinite linear',
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
				<pre>
					{buildLog && <BuildLog log={buildLog} />}
					{message && <p> {message}</p>}
				</pre>
			</div>
		</body>
		<style
			dangerouslySetInnerHTML={{
				__html: `
				.dserve-toolbar:hover {
					background: #ffffff;
					color: #2e4453;
				}

				@keyframes progress-bar-animation {
						0%   { background-position: 400px 50px; }
						100% {  }
				}
		`,
			}}
		/>
	</html>
);

type RenderContext = { buildLog?: string; message?: string };
export default function renderApp(renderContext: RenderContext) {
	return ReactDOMServer.renderToStaticNodeStream(<App {...renderContext} />);
}
