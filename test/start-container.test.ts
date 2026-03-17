describe( 'startContainer', () => {
	const listContainers = jest.fn();
	const run = jest.fn();

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
			timing: jest.fn(),
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
} );
