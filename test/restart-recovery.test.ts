jest.mock( 'hot-shots', () => ( {
	StatsD: jest.fn( () => ( {
		increment: jest.fn(),
		decrement: jest.fn(),
		gauge: jest.fn(),
		timing: jest.fn(),
	} ) ),
} ) );

describe( 'dserve restart recovery', () => {
	let fetchImpl: jest.Mock;

	beforeEach( () => {
		jest.resetModules();

		fetchImpl = jest.fn().mockResolvedValue( { status: 200 } );

		// node-fetch is called by ensureHealthProbeFor → pollUntilHealthy. Stub it so
		// tests can control probe responses without real network calls.
		jest.doMock( 'node-fetch', () => ( {
			__esModule: true,
			default: fetchImpl,
		} ) );

		jest.doMock( '../src/builder', () => ( {
			pendingHashes: new Set(),
		} ) );

		jest.doMock( '../src/logger', () => ( {
			l: {
				info: jest.fn(),
				warn: jest.fn(),
				error: jest.fn(),
			},
		} ) );
	} );

	test( 'a running container discovered via refresh (not startContainer) eventually becomes healthy', async () => {
		const {
			ensureHealthProbesForRunningContainers,
			state,
		} = require( '../src/api' );

		// Simulate the state dserve would be in right after a restart: containers
		// known from the Docker daemon (via refreshContainers) but healthyContainers
		// empty because the in-memory set was lost on restart.
		state.containers = new Map( [
			[
				'post-restart-id',
				{
					Id: 'post-restart-id',
					Image: 'dserve-wpcalypso:abc123',
					State: 'running',
					Ports: [ { PublicPort: 54321 } ],
					Labels: { calypsoEnvironment: 'calypso' },
				},
			],
		] );
		state.healthyContainers = new Set();
		state.probingContainers = new Set();

		ensureHealthProbesForRunningContainers();

		// The probe is fire-and-forget; let it settle.
		await new Promise( resolve => setImmediate( resolve ) );
		await new Promise( resolve => setImmediate( resolve ) );

		expect( state.healthyContainers.has( 'post-restart-id' ) ).toBe( true );
		expect( state.probingContainers.has( 'post-restart-id' ) ).toBe( false );

		// Proves the real pollUntilHealthy → probeContainerHealth → fetch path ran,
		// not a mock shortcut.
		expect( fetchImpl ).toHaveBeenCalled();
		const url = fetchImpl.mock.calls[ 0 ][ 0 ];
		expect( url ).toBe( 'http://127.0.0.1:54321/health' );
	} );
} );
