import { beforeEach, describe, expect, test, vi } from 'vitest';

describe( 'startContainer', () => {
	const listContainers = vi.fn();
	const run = vi.fn();

	beforeEach( () => {
		vi.resetModules();
		vi.clearAllMocks();

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

		vi.doMock( 'dockerode', () => ( {
			// A function, not an arrow, as dserve constructs it with `new`.
			default: vi.fn( function () {
				return { listContainers, run };
			} ),
		} ) );
		vi.doMock( 'get-port', () => ( { default: vi.fn().mockResolvedValue( 12345 ) } ) );
		vi.doMock( '../src/builder', () => ( {
			pendingHashes: new Set(),
		} ) );
		vi.doMock( '../src/logger', () => ( {
			l: {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			},
		} ) );
		vi.doMock( '../src/stats', () => ( {
			timing: vi.fn(),
		} ) );
	} );

	test( 'publishes the exposed port when starting an existing image', async () => {
		const realSetTimeout = global.setTimeout;
		try {
			( global as any ).setTimeout = ( fn: Function ) => {
				fn();
				return 0;
			};

			const { startContainer } = await import( '../src/api' );

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
