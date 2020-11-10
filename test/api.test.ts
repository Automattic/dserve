import { getExpiredContainers, getImageName, state } from '../src/api';

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

		test.only( 'returns empty list if everything was accessed before expiry', () => {
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
} );
