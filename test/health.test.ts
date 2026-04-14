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
