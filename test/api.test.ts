import {
	getCommitAccessTime,
	touchCommit,
	getExpiredContainers,
	getImageName,
	state,
} from '../src/api';

import { CONTAINER_EXPIRY_TIME } from '../src/constants';

describe( 'api', () => {
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
			{ Image: getImageName( '1' ), Id: 1, Created: EXPIRED_TIME / 1000 },
			{ Image: getImageName( '2' ), Id: 1, Created: EXPIRED_TIME / 1000 },
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
			state.accesses.set( '1', GOOD_TIME );
			state.accesses.set( '2', GOOD_TIME );

			expect( getExpiredContainers() ).toEqual( [] );
		} );

		test( 'returns list of only images that have not expired', () => {
			state.accesses.set( '1', Date.now() );

			expect( getExpiredContainers() ).toEqual( [ state.containers.get( getImageName( '2' ) ) ] );
		} );

		test( 'young images are not returned, regardless of access time', () => {
			state.containers.get( getImageName( '1' ) ).Created = Date.now() / 1000;

			expect( getExpiredContainers() ).toEqual( [ state.containers.get( getImageName( '2' ) ) ] );
		} );
	} );

	describe( 'commitAccessTimes', () => {
		beforeEach( () => {
			jest.resetModules();
		} );
		test( 'should return undefined for non-existent hash', () => {
			expect( getCommitAccessTime( 'nanana' ) ).toBe( undefined );
		} );

		test( 'should return a date for touched commit', () => {
			touchCommit( 'touched' );
			expect( getCommitAccessTime( 'touched' ) ).toEqual( expect.any( Number ) );
		} );

		test( 'should return same time for a commit that doesnt get touched again', () => {
			touchCommit( 'touched' );
			const touch1 = getCommitAccessTime( 'touched' );
			touchCommit( 'nanan' );
			expect( getCommitAccessTime( 'touched' ) ).toBe( touch1 );
		} );

		test( 'should update a commit touch date to be newer if called again', () => {
			const RealNow = Date.now;

			let count = 0;
			Date.now = jest.fn().mockImplementation( () => count++ );

			touchCommit( 'touched' );
			const touch1 = getCommitAccessTime( 'touched' );
			touchCommit( 'touched' );
			const touch2 = getCommitAccessTime( 'touched' );
			expect( touch2 ).toBeGreaterThan( touch1 );

			Date.now = RealNow;
		} );
	} );
} );
