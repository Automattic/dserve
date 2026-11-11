jest.mock( 'hot-shots', () => ( {
	StatsD: jest.fn( () => ( {
		increment: jest.fn(),
		decrement: jest.fn(),
		gauge: jest.fn(),
		timing: jest.fn(),
	} ) ),
} ) );

describe( 'refreshContainers fire-and-forget invariant', () => {
	const listContainers = jest.fn();
	const pollUntilHealthy = jest.fn();

	beforeEach( () => {
		jest.resetModules();
		jest.clearAllMocks();

		listContainers.mockResolvedValue( [
			{
				Id: 'cid-fire-and-forget',
				Image: 'dserve-wpcalypso:facef00d',
				State: 'running',
				Ports: [ { PublicPort: 30000 } ],
				Labels: { calypsoEnvironment: 'calypso' },
			},
		] );

		jest.doMock( 'dockerode', () =>
			jest.fn().mockImplementation( () => ( {
				listContainers,
			} ) )
		);
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
		jest.doMock( '../src/health', () => ( {
			pollUntilHealthy,
			probeContainerHealth: jest.fn(),
		} ) );
	} );

	test( 'refreshContainers resolves without waiting for probes to complete', async () => {
		// Probe promise that never resolves. If refreshContainers were to await
		// the fire-and-forget probe chain, this test would hang until jest's
		// default 5s timeout and fail.
		pollUntilHealthy.mockReturnValueOnce( new Promise( () => {} ) );

		const { refreshContainers, state } = require( '../src/api' );

		const start = Date.now();
		await refreshContainers();
		const elapsed = Date.now() - start;

		expect( elapsed ).toBeLessThan( 500 );

		// The probe did start — sanity check that the scan actually kicked it off
		// rather than skipping the container on some predicate.
		expect( state.probingContainers.has( 'cid-fire-and-forget' ) ).toBe( true );
		expect( pollUntilHealthy ).toHaveBeenCalledTimes( 1 );
	} );
} );
