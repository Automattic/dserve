jest.mock( 'hot-shots', () => ( {
	StatsD: jest.fn( () => ( {
		increment: jest.fn(),
		decrement: jest.fn(),
		gauge: jest.fn(),
		timing: jest.fn(),
	} ) ),
} ) );

describe( 'ensureHealthProbeFor', () => {
	const pollUntilHealthy = jest.fn();

	beforeEach( () => {
		jest.resetModules();
		jest.clearAllMocks();

		jest.doMock( '../src/health', () => ( {
			pollUntilHealthy: pollUntilHealthy.mockResolvedValue( 'healthy' ),
			probeContainerHealth: jest.fn(),
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

	const runningDserveContainer = ( id: string, hash: string, port: number ) => ( {
		Id: id,
		Image: `dserve-wpcalypso:${ hash }`,
		State: 'running',
		Ports: [ { PublicPort: port } ],
		Labels: { calypsoEnvironment: 'calypso' },
	} );

	test( 'starts a probe when the container is not healthy and not already being probed', () => {
		const { ensureHealthProbeFor, state } = require( '../src/api' );
		state.containers = new Map();
		state.healthyContainers = new Set();
		state.probingContainers = new Set();

		const container = runningDserveContainer( 'cid-1', 'abcdef', 12345 );
		state.containers.set( container.Id, container );

		ensureHealthProbeFor( container );

		expect( pollUntilHealthy ).toHaveBeenCalledTimes( 1 );
		expect( pollUntilHealthy.mock.calls[ 0 ][ 0 ].port ).toBe( 12345 );
		expect( state.probingContainers.has( 'cid-1' ) ).toBe( true );
	} );

	test( 'does not start a probe for a container already marked healthy', () => {
		const { ensureHealthProbeFor, state } = require( '../src/api' );
		state.containers = new Map();
		state.healthyContainers = new Set( [ 'cid-1' ] );
		state.probingContainers = new Set();

		const container = runningDserveContainer( 'cid-1', 'abcdef', 12345 );
		state.containers.set( container.Id, container );

		ensureHealthProbeFor( container );

		expect( pollUntilHealthy ).not.toHaveBeenCalled();
	} );

	test( 'does not start a duplicate probe when one is already in flight', () => {
		const { ensureHealthProbeFor, state } = require( '../src/api' );
		state.containers = new Map();
		state.healthyContainers = new Set();
		state.probingContainers = new Set( [ 'cid-1' ] );

		const container = runningDserveContainer( 'cid-1', 'abcdef', 12345 );
		state.containers.set( container.Id, container );

		ensureHealthProbeFor( container );

		expect( pollUntilHealthy ).not.toHaveBeenCalled();
	} );

	test( 'skips containers whose image is not a dserve image', () => {
		const { ensureHealthProbeFor, state } = require( '../src/api' );
		state.containers = new Map();
		state.healthyContainers = new Set();
		state.probingContainers = new Set();

		const container = {
			Id: 'cid-1',
			Image: 'nginx:latest',
			State: 'running',
			Ports: [ { PublicPort: 80 } ],
			Labels: {},
		};
		state.containers.set( container.Id, container );

		ensureHealthProbeFor( container );

		expect( pollUntilHealthy ).not.toHaveBeenCalled();
	} );

	test( 'skips containers that have no published port yet', () => {
		const { ensureHealthProbeFor, state } = require( '../src/api' );
		state.containers = new Map();
		state.healthyContainers = new Set();
		state.probingContainers = new Set();

		const container = {
			Id: 'cid-1',
			Image: 'dserve-wpcalypso:abcdef',
			State: 'running',
			Ports: [] as Array< { PublicPort: number } >,
			Labels: { calypsoEnvironment: 'calypso' },
		};
		state.containers.set( container.Id, container );

		ensureHealthProbeFor( container );

		expect( pollUntilHealthy ).not.toHaveBeenCalled();
		expect( state.probingContainers.has( 'cid-1' ) ).toBe( false );
	} );

	test( 'removes the id from probingContainers once the probe resolves and marks healthy', async () => {
		const { ensureHealthProbeFor, state } = require( '../src/api' );
		state.containers = new Map();
		state.healthyContainers = new Set();
		state.probingContainers = new Set();

		const container = runningDserveContainer( 'cid-1', 'abcdef', 12345 );
		state.containers.set( container.Id, container );

		await ensureHealthProbeFor( container );

		expect( state.probingContainers.has( 'cid-1' ) ).toBe( false );
		expect( state.healthyContainers.has( 'cid-1' ) ).toBe( true );
	} );

	test( 'removes the id from probingContainers on ceiling-exceeded (fail-open)', async () => {
		pollUntilHealthy.mockResolvedValueOnce( 'ceiling-exceeded' );
		const { ensureHealthProbeFor, state } = require( '../src/api' );
		state.containers = new Map();
		state.healthyContainers = new Set();
		state.probingContainers = new Set();

		const container = runningDserveContainer( 'cid-1', 'abcdef', 12345 );
		state.containers.set( container.Id, container );

		await ensureHealthProbeFor( container );

		expect( state.probingContainers.has( 'cid-1' ) ).toBe( false );
		expect( state.healthyContainers.has( 'cid-1' ) ).toBe( true );
	} );
} );
