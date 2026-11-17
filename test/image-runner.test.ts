const REPO = 'registry.a8c.com/calypso/app';
const SHA = '20ab23234e264bedc031b01e29efa0c6494b0948';
const OTHER_SHA = 'feedfacefeedfacefeedfacefeedfacefeedface';
const COMMIT_IMAGE = `${ REPO }:commit-${ SHA }`;
const BUILD_IMAGE = `${ REPO }:build-208013`;
const VALID_LABELS = { 'com.a8c.target': 'calypso-live' };
const REGISTRY_404 = '(HTTP code 404) unexpected - manifest unknown';
const NEW_CONTAINER = {
	Id: 'new-container',
	Image: COMMIT_IMAGE,
	Names: [ '/happy_turing' ],
	State: 'created',
	Labels: { calypsoEnvironment: 'calypso' },
};

type LocalImage = {
	Id: string;
	RepoTags: string[];
	Labels?: Record< string, string >;
	Created: number;
	sha: string;
};

describe( 'image-runner middleware', () => {
	let localImages: LocalImage[];
	let containers: any[];
	const inspect = jest.fn();
	const tag = jest.fn();
	const createContainer = jest.fn();
	const pull = jest.fn();

	// Loads the modules against a mocked Docker daemon holding `localImages`.
	async function loadModules() {
		jest.doMock( 'dockerode', () =>
			jest.fn().mockImplementation( () => ( {
				listImages: jest.fn( async () => localImages.map( ( { sha, ...image } ) => image ) ),
				listContainers: jest.fn( async () => containers ),
				pull,
				modem: { followProgress: jest.fn() },
				createContainer,
				getImage: ( id: string ) => ( {
					inspect: () => inspect( id ),
					tag: ( options: { repo: string; tag: string } ) => tag( id, options ),
				} ),
			} ) )
		);

		const api = require( '../src/api' );
		await api.refreshLocalImages();
		return require( '../src/image-runner' );
	}

	// Runs the middleware, resolving once it redirects or hands an error to next().
	function request( middleware: Function, image: string ) {
		return new Promise< { redirect?: string; error?: any } >( resolve => {
			const req = {
				query: { image },
				headers: { host: 'calypso.live' },
				secure: true,
				path: '/',
			};
			const res = {
				header: jest.fn(),
				redirect: ( url: string ) => resolve( { redirect: url } ),
			};
			middleware( req, res, ( error: any ) => resolve( { error } ) );
		} );
	}

	beforeEach( () => {
		jest.resetModules();
		jest.clearAllMocks();

		containers = [];
		localImages = [];
		pull.mockRejectedValue( new Error( REGISTRY_404 ) );

		inspect.mockImplementation( async ( id: string ) => {
			const image = localImages.find( candidate => candidate.Id === id );
			return { Id: id, Config: { Env: [ 'PATH=/usr/bin', `COMMIT_SHA=${ image.sha }` ] } };
		} );
		tag.mockImplementation( async ( id: string, options: { repo: string; tag: string } ) => {
			localImages
				.find( candidate => candidate.Id === id )
				.RepoTags.push( `${ options.repo }:${ options.tag }` );
		} );
		createContainer.mockImplementation( async () => {
			containers = [ NEW_CONTAINER ];
			return { id: NEW_CONTAINER.Id };
		} );

		jest.doMock( 'get-port', () => jest.fn().mockResolvedValue( 12345 ) );
		jest.doMock( '../src/builder', () => ( { pendingHashes: new Set() } ) );
		jest.doMock( '../src/logger', () => ( {
			l: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
		} ) );
		jest.doMock( '../src/stats', () => ( { timing: jest.fn() } ) );
	} );

	test( 'tags a local image built from the commit when the registry dropped the tag', async () => {
		localImages = [
			{
				Id: 'sha256:build',
				RepoTags: [ BUILD_IMAGE ],
				Labels: VALID_LABELS,
				Created: 100,
				sha: SHA,
			},
		];
		const { middleware } = await loadModules();

		const result = await request( middleware, COMMIT_IMAGE );

		expect( tag ).toHaveBeenCalledWith( 'sha256:build', {
			repo: REPO,
			tag: `commit-${ SHA }`,
		} );
		expect( createContainer.mock.calls[ 0 ][ 0 ] ).toMatchObject( { Image: COMMIT_IMAGE } );
		expect( result ).toEqual( {
			redirect: 'https://container-happy-turing.calypso.live/',
		} );
	} );

	test( 'tags the newest local image when several were built from the commit', async () => {
		localImages = [
			{
				Id: 'sha256:old',
				RepoTags: [ `${ REPO }:build-1` ],
				Labels: VALID_LABELS,
				Created: 100,
				sha: SHA,
			},
			{
				Id: 'sha256:new',
				RepoTags: [ `${ REPO }:build-3` ],
				Labels: VALID_LABELS,
				Created: 300,
				sha: SHA,
			},
			{
				Id: 'sha256:mid',
				RepoTags: [ `${ REPO }:build-2` ],
				Labels: VALID_LABELS,
				Created: 200,
				sha: SHA,
			},
		];
		const { middleware } = await loadModules();

		const result = await request( middleware, COMMIT_IMAGE );

		expect( tag ).toHaveBeenCalledTimes( 1 );
		expect( tag.mock.calls[ 0 ][ 0 ] ).toBe( 'sha256:new' );
		expect( result.redirect ).toBeDefined();
	} );

	test( 'throws ImageNotFound when no local image was built from the commit', async () => {
		localImages = [
			{
				Id: 'sha256:other',
				RepoTags: [ BUILD_IMAGE, `${ REPO }:build-208012` ],
				Labels: VALID_LABELS,
				Created: 100,
				sha: OTHER_SHA,
			},
			{
				Id: 'sha256:prefix',
				RepoTags: [ `${ REPO }:build-2` ],
				Labels: VALID_LABELS,
				Created: 200,
				sha: `${ SHA }0`,
			},
			{
				Id: 'sha256:other-repo',
				RepoTags: [ `${ REPO }-other:build-1` ],
				Labels: VALID_LABELS,
				Created: 300,
				sha: SHA,
			},
		];
		const { middleware } = await loadModules();
		const { ImageNotFound } = require( '../src/error' );

		const result = await request( middleware, COMMIT_IMAGE );

		expect( result.error ).toBeInstanceOf( ImageNotFound );
		expect( result.error.imageName ).toBe( COMMIT_IMAGE );
		expect( inspect.mock.calls ).toEqual( [ [ 'sha256:prefix' ], [ 'sha256:other' ] ] );
		expect( tag ).not.toHaveBeenCalled();
		expect( createContainer ).not.toHaveBeenCalled();
	} );

	test( 'ignores local images not built for Calypso Live', async () => {
		localImages = [
			{ Id: 'sha256:unlabelled', RepoTags: [ BUILD_IMAGE ], Created: 100, sha: SHA },
		];
		const { middleware } = await loadModules();
		const { ImageNotFound } = require( '../src/error' );

		const result = await request( middleware, COMMIT_IMAGE );

		expect( result.error ).toBeInstanceOf( ImageNotFound );
		expect( inspect ).not.toHaveBeenCalled();
		expect( tag ).not.toHaveBeenCalled();
	} );

	test( 'throws ImageNotFound without a fallback for non-commit tags', async () => {
		localImages = [
			{
				Id: 'sha256:build',
				RepoTags: [ `${ REPO }:build-1` ],
				Labels: VALID_LABELS,
				Created: 100,
				sha: SHA,
			},
		];
		const { middleware } = await loadModules();
		const { ImageNotFound } = require( '../src/error' );

		const result = await request( middleware, BUILD_IMAGE );

		expect( result.error ).toBeInstanceOf( ImageNotFound );
		expect( inspect ).not.toHaveBeenCalled();
		expect( tag ).not.toHaveBeenCalled();
	} );

	test( 'rethrows registry errors other than 404 without a fallback', async () => {
		const registryError = new Error( '(HTTP code 500) server error' );
		pull.mockRejectedValue( registryError );
		localImages = [
			{
				Id: 'sha256:build',
				RepoTags: [ BUILD_IMAGE ],
				Labels: VALID_LABELS,
				Created: 100,
				sha: SHA,
			},
		];
		const { middleware } = await loadModules();

		const result = await request( middleware, COMMIT_IMAGE );

		expect( result.error ).toBe( registryError );
		expect( inspect ).not.toHaveBeenCalled();
		expect( tag ).not.toHaveBeenCalled();
	} );

	test.each( [ [ 'inspecting', inspect ], [ 'tagging', tag ] ] )(
		'fails without creating a container when %s the local image fails',
		async ( _step, failingCall ) => {
			const dockerError = new Error( '(HTTP code 404) no such image' );
			failingCall.mockRejectedValue( dockerError );
			localImages = [
				{
					Id: 'sha256:build',
					RepoTags: [ BUILD_IMAGE ],
					Labels: VALID_LABELS,
					Created: 100,
					sha: SHA,
				},
			];
			const { middleware } = await loadModules();

			const result = await request( middleware, COMMIT_IMAGE );

			expect( result.error ).toBe( dockerError );
			expect( createContainer ).not.toHaveBeenCalled();
		}
	);
} );
