import { getExpiredContainers, getImageName, state, docker, pullImage } from '../src/api';
import { CONTAINER_EXPIRY_TIME } from '../src/constants';

jest.mock( 'dockerode', () => {
	return jest.fn().mockImplementation( () => ( {
		pull: jest.fn(),
		modem: {
			followProgress: jest.fn(),
		},
	} ) );
} );

describe( 'api', () => {
	describe( 'pullImage', () => {
		const mockImageName = 'test-image:latest';
		const mockOnProgress = jest.fn();

		beforeEach( () => {
			state.pullingImages = new Map();
			jest.clearAllMocks();
			mockOnProgress.mockClear();
		} );

		test( 'should store promise in state.pullingImages and clean up on success', async () => {
			( docker.pull as jest.Mock ).mockResolvedValue( 'mock-stream' );

			( docker.modem.followProgress as jest.Mock ).mockImplementation( ( _stream, callback ) => {
				callback( null );
			} );

			expect( state.pullingImages.has( mockImageName ) ).toBe( false );

			const pullPromise = pullImage( mockImageName, mockOnProgress );

			expect( state.pullingImages.has( mockImageName ) ).toBe( true );

			// Wait for the promise to resolve
			await pullPromise;

			// Should clean up after successful completion
			expect( state.pullingImages.has( mockImageName ) ).toBe( false );
		} );

		test( 'should reuse existing promise for concurrent requests', async () => {
			( docker.pull as jest.Mock ).mockResolvedValue( 'mock-stream' );

			( docker.modem.followProgress as jest.Mock ).mockImplementation( ( _stream, callback ) => {
				callback( null );
			} );

			// Start first request
			const firstRequest = pullImage( mockImageName, mockOnProgress );
			expect( state.pullingImages.has( mockImageName ) ).toBe( true );
			expect( docker.pull ).toHaveBeenCalledTimes( 1 );

			// Start second request while first is still in progress (should reuse the same promise)
			const secondRequest = pullImage( mockImageName, mockOnProgress );
			expect( state.pullingImages.has( mockImageName ) ).toBe( true );
			// docker.pull should not be called again
			expect( docker.pull ).toHaveBeenCalledTimes( 1 );

			await Promise.all( [ firstRequest, secondRequest ] );
			expect( state.pullingImages.has( mockImageName ) ).toBe( false );
		} );

		test( 'should clean up state.pullingImages when followProgress callback receives error', async () => {
			( docker.pull as jest.Mock ).mockResolvedValue( 'mock-stream' );
			( docker.modem.followProgress as jest.Mock ).mockImplementation( ( _stream, callback ) => {
				callback( new Error( 'Follow progress error' ) );
			} );

			expect( state.pullingImages.has( mockImageName ) ).toBe( false );

			const pullPromise = pullImage( mockImageName, mockOnProgress );
			expect( state.pullingImages.has( mockImageName ) ).toBe( true );

			await expect( pullPromise ).rejects.toThrow( 'Follow progress error' );

			expect( state.pullingImages.has( mockImageName ) ).toBe( false );
		} );

		test( 'should allow retry after docker.pull error', async () => {
			( docker.pull as jest.Mock ).mockRejectedValue( new Error( 'Image not found' ) );

			// First call fails
			await expect( pullImage( mockImageName, mockOnProgress ) ).rejects.toThrow(
				'Image not found'
			);
			expect( docker.pull ).toHaveBeenCalledTimes( 1 );
			expect( state.pullingImages.has( mockImageName ) ).toBe( false );

			// Mock a successful pull for retry
			( docker.pull as jest.Mock ).mockResolvedValue( 'mock-stream' );
			( docker.modem.followProgress as jest.Mock ).mockImplementation( ( _stream, callback ) => {
				callback( null );
			} );

			// Second call should work and call docker.pull again
			await pullImage( mockImageName, mockOnProgress );
			expect( docker.pull ).toHaveBeenCalledTimes( 2 );
			expect( state.pullingImages.has( mockImageName ) ).toBe( false );
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
			state.containers.get( getImageName( '1' ) )!.Created = Date.now() / 1000;

			expect( getExpiredContainers() ).toEqual( [ state.containers.get( getImageName( '2' ) ) ] );
		} );
	} );
} );
