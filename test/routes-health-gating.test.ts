import { decideRouteAction } from '../src/route-actions';

describe( 'decideRouteAction', () => {
	const baseFacts = {
		commitHash: 'feedface',
		runEnv: 'calypso',
		hasLocally: true,
		isCurrentlyBuilding: false,
		isRunning: true,
		isHealthy: true,
		didFail: false,
		shouldReset: false,
		acceptsHtml: true,
	};

	test( 'proxies when container is running and healthy', () => {
		expect( decideRouteAction( baseFacts ) ).toEqual( { kind: 'proxy' } );
	} );

	test( 'shows loading page when running but not healthy and client wants HTML', () => {
		expect(
			decideRouteAction( { ...baseFacts, isHealthy: false, acceptsHtml: true } )
		).toEqual( { kind: 'loading', message: 'Starting container, this page will refresh shortly' } );
	} );

	test( 'returns 503 when running but not healthy and client does not want HTML', () => {
		expect(
			decideRouteAction( { ...baseFacts, isHealthy: false, acceptsHtml: false } )
		).toEqual( { kind: 'not-ready' } );
	} );

	test( 'reports "build in progress" when building', () => {
		expect(
			decideRouteAction( {
				...baseFacts,
				hasLocally: false,
				isCurrentlyBuilding: true,
				isRunning: false,
				isHealthy: false,
			} )
		).toEqual( { kind: 'show-build-log' } );
	} );

	test( 'enqueues build when nothing is built and nothing is in progress', () => {
		expect(
			decideRouteAction( {
				...baseFacts,
				hasLocally: false,
				isCurrentlyBuilding: false,
				isRunning: false,
				isHealthy: false,
			} )
		).toEqual( { kind: 'enqueue-build' } );
	} );

	test( 'starts the container when image exists but no container is running', () => {
		expect(
			decideRouteAction( {
				...baseFacts,
				isRunning: false,
				isHealthy: false,
			} )
		).toEqual( { kind: 'start-container' } );
	} );

	test( 'honors reset intent regardless of other state', () => {
		expect(
			decideRouteAction( { ...baseFacts, shouldReset: true } )
		).toEqual( { kind: 'reset' } );
	} );
} );
