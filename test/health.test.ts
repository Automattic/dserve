describe( 'probeContainerHealth', () => {
	beforeEach( () => {
		jest.resetModules();
	} );

	test( 'returns true when fetch resolves with 200', async () => {
		const fetchImpl = jest.fn().mockResolvedValue( { status: 200 } );
		const { probeContainerHealth } = require( '../src/health' );

		const result = await probeContainerHealth( 12345, {
			fetchImpl,
			healthPath: '/health',
			timeoutMs: 1000,
		} );

		expect( result ).toBe( true );
		expect( fetchImpl ).toHaveBeenCalledTimes( 1 );
		const [ url ] = fetchImpl.mock.calls[ 0 ];
		expect( url ).toBe( 'http://127.0.0.1:12345/health' );
	} );

	test( 'returns false when fetch resolves with non-200', async () => {
		const fetchImpl = jest.fn().mockResolvedValue( { status: 503 } );
		const { probeContainerHealth } = require( '../src/health' );

		const result = await probeContainerHealth( 12345, {
			fetchImpl,
			healthPath: '/health',
			timeoutMs: 1000,
		} );

		expect( result ).toBe( false );
	} );

	test( 'returns false when fetch rejects (connection refused)', async () => {
		const fetchImpl = jest.fn().mockRejectedValue( new Error( 'ECONNREFUSED' ) );
		const { probeContainerHealth } = require( '../src/health' );

		const result = await probeContainerHealth( 12345, {
			fetchImpl,
			healthPath: '/health',
			timeoutMs: 1000,
		} );

		expect( result ).toBe( false );
	} );
} );

describe( 'pollUntilHealthy', () => {
	beforeEach( () => {
		jest.resetModules();
		jest.useFakeTimers();
	} );

	afterEach( () => {
		jest.useRealTimers();
	} );

	test( 'resolves with "healthy" on first successful probe', async () => {
		const fetchImpl = jest.fn().mockResolvedValue( { status: 200 } );
		const { pollUntilHealthy } = require( '../src/health' );

		const outcome = await pollUntilHealthy( {
			port: 12345,
			fetchImpl,
			healthPath: '/health',
			intervalMs: 500,
			ceilingMs: 30000,
			probeTimeoutMs: 1000,
		} );

		expect( outcome ).toBe( 'healthy' );
		expect( fetchImpl ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'retries until success', async () => {
		const fetchImpl = jest
			.fn()
			.mockResolvedValueOnce( { status: 503 } )
			.mockResolvedValueOnce( { status: 503 } )
			.mockResolvedValueOnce( { status: 200 } );
		const { pollUntilHealthy } = require( '../src/health' );

		const promise = pollUntilHealthy( {
			port: 12345,
			fetchImpl,
			healthPath: '/health',
			intervalMs: 500,
			ceilingMs: 30000,
			probeTimeoutMs: 1000,
		} );

		// Drain all pending microtasks + timers until the loop completes.
		await jest.runAllTimersAsync();
		const outcome = await promise;

		expect( outcome ).toBe( 'healthy' );
		expect( fetchImpl ).toHaveBeenCalledTimes( 3 );
	} );

	test( 'resolves with "ceiling-exceeded" when ceilingMs elapses without success', async () => {
		const fetchImpl = jest.fn().mockResolvedValue( { status: 503 } );
		const { pollUntilHealthy } = require( '../src/health' );

		const promise = pollUntilHealthy( {
			port: 12345,
			fetchImpl,
			healthPath: '/health',
			intervalMs: 500,
			ceilingMs: 2000,
			probeTimeoutMs: 1000,
		} );

		await jest.runAllTimersAsync();
		const outcome = await promise;

		expect( outcome ).toBe( 'ceiling-exceeded' );
		// ceilingMs=2000 / intervalMs=500 => at least 4 probes, at most 5 including the final attempt
		expect( fetchImpl.mock.calls.length ).toBeGreaterThanOrEqual( 4 );
		expect( fetchImpl.mock.calls.length ).toBeLessThanOrEqual( 5 );
	} );

	test( 'stops polling when aborted', async () => {
		const fetchImpl = jest.fn().mockResolvedValue( { status: 503 } );
		const { pollUntilHealthy } = require( '../src/health' );

		const abort = { aborted: false };
		const promise = pollUntilHealthy( {
			port: 12345,
			fetchImpl,
			healthPath: '/health',
			intervalMs: 500,
			ceilingMs: 30000,
			probeTimeoutMs: 1000,
			shouldAbort: () => abort.aborted,
		} );

		// Let one probe fire, then abort.
		await jest.advanceTimersByTimeAsync( 500 );
		abort.aborted = true;
		await jest.runAllTimersAsync();
		const outcome = await promise;

		expect( outcome ).toBe( 'aborted' );
	} );
} );
