import * as React from 'react';

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

export const Shell = ({ refreshInterval, children }: any) => (
	<html>
		<head>
            { 'number' === typeof refreshInterval && <Reloader milliseconds={ refreshInterval } /> }
        </head>
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
				<div className="dserve-toolbar">
                    <a href="/log">Logs</a>
                    <a href="/localimages">Local Images</a>
					<a href="https://github.com/Automattic/dserve/issues">Report issues</a>
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
                { children }
			</div>
		</body>
		<style
			dangerouslySetInnerHTML={{
                __html: `
                .dserve-toolbar {
                    position: absolute;
                    top: 12px;
                    right: 4px;
                    box-sizing: border-box;
                    display: flex;
                }

                .dserve-toolbar a {
                    display: inline-block;
                    border: 1px solid #ffffff;
                    border-radius: 3px;
                    padding: 4px 6px;
                    margin: 0 10px 0 0;
                    fontSize: 12;
                    text-decoration: none;
                    color: #ffffff;
                    background: #2e4453;
                    transition: all 200ms ease-in;
                }

				.dserve-toolbar a:hover {
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