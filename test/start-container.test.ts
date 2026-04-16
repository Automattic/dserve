describe( 'startContainer', () => {
	const listContainers = jest.fn();
	const run = jest.fn();
	const pollUntilHealthy = jest.fn();

	beforeEach( () => {
		jest.resetModules();
		jest.clearAllMocks();

		listContainers.mockResolvedValue( [
			{
				Id: 'container-id',
				Image: 'dserve-wpcalypso:feedface',
				State: 'running',
				Ports: [ { PublicPort: 12345 } ],
				Labels: {
					calypsoEnvironment: 'calypso',
				},
			},
		] );

		jest.doMock( 'dockerode', () =>
			jest.fn().mockImplementation( () => ( {
				listContainers,
				run,
			} ) )
		);
		jest.doMock( 'get-port', () => jest.fn().mockResolvedValue( 12345 ) );
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
		jest.doMock( '../src/stats', () => ( {
			increment: jest.fn(),
			decrement: jest.fn(),
			gauge: jest.fn(),
			timing: jest.fn(),
		} ) );
		jest.doMock( '../src/health', () => ( {
			pollUntilHealthy: pollUntilHealthy.mockResolvedValue( 'healthy' ),
			probeContainerHealth: jest.fn(),
		} ) );
	} );

	test( 'publishes the exposed port when starting an existing image', async () => {
		const realSetTimeout = global.setTimeout;
		try {
			( global as any ).setTimeout = ( fn: Function ) => {
				fn();
				return 0;
			};

			const { startContainer } = require( '../src/api' );

			await startContainer( 'feedface', 'calypso' );

			expect( run ).toHaveBeenCalledTimes( 1 );
			expect( run.mock.calls[ 0 ][ 3 ] ).toMatchObject( {
				ExposedPorts: {
					'3000/tcp': {},
				},
				HostConfig: {
					PortBindings: {
						'3000/tcp': [ { HostPort: '12345' } ],
					},
				},
				Labels: {
					calypsoEnvironment: 'calypso',
				},
				Tty: false,
			} );
			expect( run.mock.calls[ 0 ][ 3 ] ).not.toHaveProperty( 'PortBindings' );
		} finally {
			global.setTimeout = realSetTimeout;
		}
	} );

	test( 'starts health polling for the freshly started container', async () => {
		const realSetTimeout = global.setTimeout;
		try {
			( global as any ).setTimeout = ( fn: Function ) => {
				fn();
				return 0;
			};

			const { startContainer } = require( '../src/api' );

			await startContainer( 'feedface', 'calypso' );

			expect( pollUntilHealthy ).toHaveBeenCalledTimes( 1 );
			const call = pollUntilHealthy.mock.calls[ 0 ][ 0 ];
			expect( call.port ).toBe( 12345 );
			expect( call.healthPath ).toBe( '/health' );
			expect( call.intervalMs ).toBe( 500 );
			expect( call.ceilingMs ).toBe( 30000 );
		} finally {
			global.setTimeout = realSetTimeout;
		}
	} );

	test( 'marks the container healthy when pollUntilHealthy resolves to healthy', async () => {
		const realSetTimeout = global.setTimeout;
		try {
			( global as any ).setTimeout = ( fn: Function ) => {
				fn();
				return 0;
			};

			pollUntilHealthy.mockResolvedValueOnce( 'healthy' );
			const { startContainer, state } = require( '../src/api' );

			await startContainer( 'feedface', 'calypso' );

			// Let the fire-and-forget promise settle.
			await new Promise( resolve => setImmediate( resolve ) );

			expect( state.healthyContainers.has( 'container-id' ) ).toBe( true );
		} finally {
			global.setTimeout = realSetTimeout;
		}
	} );

	test( 'fails open and marks healthy on ceiling-exceeded', async () => {
		const realSetTimeout = global.setTimeout;
		try {
			( global as any ).setTimeout = ( fn: Function ) => {
				fn();
				return 0;
			};

			pollUntilHealthy.mockResolvedValueOnce( 'ceiling-exceeded' );
			const { startContainer, state } = require( '../src/api' );

			await startContainer( 'feedface', 'calypso' );
			await new Promise( resolve => setImmediate( resolve ) );

			expect( state.healthyContainers.has( 'container-id' ) ).toBe( true );
		} finally {
			global.setTimeout = realSetTimeout;
		}
	} );
} );
