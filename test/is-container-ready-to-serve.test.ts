jest.mock( 'hot-shots', () => ( {
	StatsD: jest.fn( () => ( {
		increment: jest.fn(),
		decrement: jest.fn(),
		gauge: jest.fn(),
		timing: jest.fn(),
	} ) ),
} ) );

jest.mock( '../src/health', () => ( {
	pollUntilHealthy: jest.fn().mockResolvedValue( 'healthy' ),
	probeContainerHealth: jest.fn(),
} ) );

describe( 'isContainerReadyToServe', () => {
	const runningContainer = {
		Id: 'container-id',
		Image: 'dserve-wpcalypso:feedface',
		State: 'running',
		Ports: [ { PublicPort: 12345 } ],
		Labels: { calypsoEnvironment: 'calypso' },
	};

	beforeEach( () => {
		jest.resetModules();

		jest.doMock( '../src/logger', () => ( {
			l: {
				info: jest.fn(),
				warn: jest.fn(),
				error: jest.fn(),
			},
		} ) );
	} );

	test( 'when the health gate is enabled, delegates to isContainerHealthy (false if not yet healthy)', () => {
		jest.doMock( '../src/config', () => {
			const actual = jest.requireActual( '../src/config' );
			return {
				...actual,
				config: {
					...actual.config,
					build: {
						...actual.config.build,
						healthGateEnabled: true,
					},
				},
			};
		} );

		const { isContainerReadyToServe, state } = require( '../src/api' );
		state.containers = new Map( [ [ runningContainer.Id, runningContainer ] ] );
		state.healthyContainers = new Set();
		state.probingContainers = new Set();

		expect( isContainerReadyToServe( 'feedface', 'calypso' ) ).toBe( false );
	} );

	test( 'when the health gate is enabled, returns true once the container is marked healthy', () => {
		jest.doMock( '../src/config', () => {
			const actual = jest.requireActual( '../src/config' );
			return {
				...actual,
				config: {
					...actual.config,
					build: {
						...actual.config.build,
						healthGateEnabled: true,
					},
				},
			};
		} );

		const { isContainerReadyToServe, markContainerHealthy, state } = require( '../src/api' );
		state.containers = new Map( [ [ runningContainer.Id, runningContainer ] ] );
		state.healthyContainers = new Set();
		state.probingContainers = new Set();
		markContainerHealthy( runningContainer.Id );

		expect( isContainerReadyToServe( 'feedface', 'calypso' ) ).toBe( true );
	} );

	test( 'when the health gate is disabled, returns true for any running container regardless of healthy state', () => {
		jest.doMock( '../src/config', () => {
			const actual = jest.requireActual( '../src/config' );
			return {
				...actual,
				config: {
					...actual.config,
					build: {
						...actual.config.build,
						healthGateEnabled: false,
					},
				},
			};
		} );

		const { isContainerReadyToServe, state } = require( '../src/api' );
		state.containers = new Map( [ [ runningContainer.Id, runningContainer ] ] );
		state.healthyContainers = new Set();
		state.probingContainers = new Set();

		expect( isContainerReadyToServe( 'feedface', 'calypso' ) ).toBe( true );
	} );

	test( 'when the health gate is disabled, still returns false when the container is not running', () => {
		jest.doMock( '../src/config', () => {
			const actual = jest.requireActual( '../src/config' );
			return {
				...actual,
				config: {
					...actual.config,
					build: {
						...actual.config.build,
						healthGateEnabled: false,
					},
				},
			};
		} );

		const { isContainerReadyToServe, state } = require( '../src/api' );
		state.containers = new Map();
		state.healthyContainers = new Set();
		state.probingContainers = new Set();

		expect( isContainerReadyToServe( 'feedface', 'calypso' ) ).toBe( false );
	} );
} );
