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
			<style
				dangerouslySetInnerHTML={{
					__html: `
					body {
						font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen-Sans", "Ubuntu", "Cantarell", "Helvetica Neue", sans-serif;
						background: #091e25;
						color: #ffffff;
						margin: 0;
					}

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
					}

					.dserve-toolbar a:hover {
						background: #ffffff;
						color: #2e4453;
					}

					.dserve-message {
						position: fixed;
						width: 100%;
						box-sizing: border-box;
						min-height: 55px;
						max-height: 80px;
						overflow: hidden;
						padding: 16px 20px;
						margin: 0;
						background: #2e4453;
						color: #ffffff;
						animation: progress-bar-animation 3300ms infinite linear;
						background-image: linear-gradient( -45deg, #3d596d 28%, #334b5c 28%, #334b5c 72%, #3d596d 72%);
						background-size: 200px 100%;
						background-repeat: repeat-x;
						background-position: 0 50px;
					}

					.dserve-main-contents {
						box-sizing: border-box;
						width: 100%;
						border: 0;
						padding: 86px 20px 10px 20px;
					}
			`,
				}}
			/>
        </head>
		<body>
			<div className="dserve-message">
				DServe Calypso
				<div className="dserve-toolbar">
                    <a href="/log">Logs</a>
                    <a href="/localimages">Local Images</a>
					<a href="https://github.com/Automattic/dserve/issues">Report issues</a>
				</div>
			</div>
			<div className="dserve-main-contents">
                { children }
			</div>
		</body>
	</html>
);