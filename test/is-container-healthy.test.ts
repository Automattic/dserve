jest.mock( 'hot-shots', () => ( {
	StatsD: jest.fn( () => ( {
		increment: jest.fn(),
		decrement: jest.fn(),
		gauge: jest.fn(),
		timing: jest.fn(),
	} ) ),
} ) );

const {
	getImageName,
	isContainerHealthy,
	markContainerHealthy,
	forgetContainerHealth,
	state,
} = require( '../src/api' );

describe( 'isContainerHealthy', () => {
	beforeEach( () => {
		state.containers = new Map();
		state.healthyContainers = new Set();
	} );

	test( 'returns false when the container is not running', () => {
		expect( isContainerHealthy( 'feedface', 'calypso' ) ).toBe( false );
	} );

	test( 'returns false when the container is running but not marked healthy', () => {
		const container = {
			Id: 'container-id',
			Image: getImageName( 'feedface' ),
			State: 'running',
			Ports: [ { PublicPort: 12345 } ],
			Labels: { calypsoEnvironment: 'calypso' },
		};
		state.containers.set( container.Id, container );

		expect( isContainerHealthy( 'feedface', 'calypso' ) ).toBe( false );
	} );

	test( 'returns true once the container id has been marked healthy', () => {
		const container = {
			Id: 'container-id',
			Image: getImageName( 'feedface' ),
			State: 'running',
			Ports: [ { PublicPort: 12345 } ],
			Labels: { calypsoEnvironment: 'calypso' },
		};
		state.containers.set( container.Id, container );

		markContainerHealthy( 'container-id' );

		expect( isContainerHealthy( 'feedface', 'calypso' ) ).toBe( true );
	} );

	test( 'forgetContainerHealth removes the id', () => {
		markContainerHealthy( 'container-id' );
		forgetContainerHealth( 'container-id' );
		expect( state.healthyContainers.has( 'container-id' ) ).toBe( false );
	} );
} );
