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

jest.mock( '../src/logger', () => ( {
	l: {
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		child: jest.fn().mockReturnValue( {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
		} ),
	},
	ringbuffer: { records: [] as any[] },
} ) );

import { CONTAINER_EXPIRY_TIME } from '../src/constants';

const {
	getBuildBackendFromBuilderVersion,
	getExpiredContainers,
	getImageName,
	state,
} = require( '../src/api' );

describe( 'api', () => {
	describe( 'getBuildBackendFromBuilderVersion', () => {
		test( 'maps Builder-Version=2 to BuildKit', () => {
			expect( getBuildBackendFromBuilderVersion( '2' ) ).toBe( 'buildkit' );
		} );

		test( 'maps Builder-Version=1 to the classic builder', () => {
			expect( getBuildBackendFromBuilderVersion( '1' ) ).toBe( 'classic' );
		} );

		test( 'returns unknown when the daemon omits the header', () => {
			expect( getBuildBackendFromBuilderVersion( null ) ).toBe( 'unknown' );
		} );
	} );

	describe( 'getExpiredContainers', () => {
		const RealNow = Date.now;
		const fakeNow = RealNow() + 24 * 60 * 1000;
		Date.now = () => fakeNow;

		afterAll( () => {
			Date.now = RealNow;
		} );

		const EXPIRED_TIME = Date.now() - CONTAINER_EXPIRY_TIME - 1;
		const GOOD_TIME = Date.now() - CONTAINER_EXPIRY_TIME + 1;
		const images = [
			{ Image: getImageName( '1' ), Id: 1, Created: EXPIRED_TIME / 1000, Names: [ '/foo' ] },
			{ Image: getImageName( '2' ), Id: 1, Created: EXPIRED_TIME / 1000, Names: [ '/bar' ] },
		];

		afterEach( () => {
			state.accesses = new Map();
			state.containers = new Map();
		} );

		beforeEach( () => {
			state.containers = new Map( images.map( image => [ image.Image, { ...image } ] ) as any );
		} );

		test( 'returns nothing for empty list of containers', () => {
			state.containers = new Map();
			expect( getExpiredContainers() ).toEqual( [] );
		} );

		test( 'returns the whole list if everything is expired', () => {
			expect( getExpiredContainers() ).toEqual( images );
		} );

		test( 'returns empty list if everything was accessed before expiry', () => {
			state.accesses.set( 'foo', GOOD_TIME );
			state.accesses.set( 'bar', GOOD_TIME );

			expect( getExpiredContainers() ).toEqual( [] );
		} );

		test( 'returns list of only images that have not expired', () => {
			state.accesses.set( 'foo', Date.now() );

			expect( getExpiredContainers() ).toEqual( [ state.containers.get( getImageName( '2' ) ) ] );
		} );

		test( 'young images are not returned, regardless of access time', () => {
			state.containers.get( getImageName( '1' ) ).Created = Date.now() / 1000;

			expect( getExpiredContainers() ).toEqual( [ state.containers.get( getImageName( '2' ) ) ] );
		} );
	} );

	describe( 'refreshContainers healthyContainers cleanup', () => {
		test( 'drops healthy ids that are no longer present in state.containers', () => {
			const { state, reconcileHealthyContainers } = require( '../src/api' );
			state.containers = new Map( [
				[ 'alive', { Id: 'alive', Image: 'dserve-wpcalypso:a' } ],
			] );
			state.healthyContainers = new Set( [ 'alive', 'ghost' ] );

			reconcileHealthyContainers();

			expect( Array.from( state.healthyContainers ) ).toEqual( [ 'alive' ] );
		} );

		test( 'is a no-op when every healthy id is still present', () => {
			const { state, reconcileHealthyContainers } = require( '../src/api' );
			state.containers = new Map( [
				[ 'a', { Id: 'a' } ],
				[ 'b', { Id: 'b' } ],
			] );
			state.healthyContainers = new Set( [ 'a', 'b' ] );

			reconcileHealthyContainers();

			expect( Array.from( state.healthyContainers ).sort() ).toEqual( [ 'a', 'b' ] );
		} );
	} );

	describe( 'ensureHealthProbesForRunningContainers', () => {
		test( 'starts a probe for each running dserve container that is not yet healthy', () => {
			const {
				ensureHealthProbesForRunningContainers,
				state,
			} = require( '../src/api' );

			state.containers = new Map( [
				[
					'cid-1',
					{
						Id: 'cid-1',
						Image: 'dserve-wpcalypso:aaa',
						State: 'running',
						Ports: [ { PublicPort: 11111 } ],
						Labels: { calypsoEnvironment: 'calypso' },
					},
				],
				[
					'cid-2',
					{
						Id: 'cid-2',
						Image: 'dserve-wpcalypso:bbb',
						State: 'running',
						Ports: [ { PublicPort: 22222 } ],
						Labels: { calypsoEnvironment: 'jetpack' },
					},
				],
			] );
			state.healthyContainers = new Set();
			state.probingContainers = new Set();

			ensureHealthProbesForRunningContainers();

			expect( state.probingContainers.has( 'cid-1' ) ).toBe( true );
			expect( state.probingContainers.has( 'cid-2' ) ).toBe( true );
		} );

		test( 'skips containers that are not in running state', () => {
			const {
				ensureHealthProbesForRunningContainers,
				state,
			} = require( '../src/api' );

			state.containers = new Map( [
				[
					'cid-1',
					{
						Id: 'cid-1',
						Image: 'dserve-wpcalypso:aaa',
						State: 'exited',
						Ports: [ { PublicPort: 11111 } ],
						Labels: { calypsoEnvironment: 'calypso' },
					},
				],
			] );
			state.healthyContainers = new Set();
			state.probingContainers = new Set();

			ensureHealthProbesForRunningContainers();

			expect( state.probingContainers.size ).toBe( 0 );
		} );
	} );
} );
