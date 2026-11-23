/**
 * Integration tests for `tagLocalCommitImage` against a real Docker daemon: they check what the
 * mocked unit tests cannot, i.e. that `tag()` applies the tag, that `COMMIT_SHA` comes back from a
 * real `inspect()`, that `listImages()` reports the new tag right after tagging, and that `Created`
 * orders real images newest first.
 *
 * Opt-in, as they need a daemon and build images: `DSERVE_DOCKER_TESTS=1 yarn test`.
 */

jest.mock( 'hot-shots', () => ( {
	StatsD: jest.fn( () => ( {
		increment: jest.fn(),
		decrement: jest.fn(),
		gauge: jest.fn(),
		timing: jest.fn(),
	} ) ),
} ) );

import * as tar from 'tar-stream';

const { docker, getAllImages, refreshLocalImages, tagLocalCommitImage } = require( '../src/api' );

// A repository of its own, so the tests never touch images of the repository dserve serves.
const REPO = 'dserve-it.local/calypso/app';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const OTHER_SHA = 'fedcba9876543210fedcba9876543210fedcba98';
const COMMIT_TAG = `${ REPO }:commit-${ SHA }`;

const BUILD_TIMEOUT = 60000;
// Image timestamps have a one-second resolution, so builds need spacing to be ordered by age.
const CREATED_RESOLUTION = 1100;

const tagsToRemove: string[] = [];

/** Builds an empty image carrying the Calypso Live label and the given commit in its env. */
async function buildImage( tag: string, sha: string ) {
	const pack = tar.pack();
	pack.entry(
		{ name: 'Dockerfile' },
		`FROM scratch\nLABEL com.a8c.target=calypso-live\nENV COMMIT_SHA=${ sha }\n`
	);
	pack.finalize();

	const stream = await docker.buildImage( pack, { t: tag } );
	await new Promise( ( resolve, reject ) => {
		docker.modem.followProgress( stream, ( err: Error, output: any ) =>
			err ? reject( err ) : resolve( output )
		);
	} );
	tagsToRemove.push( tag );
}

const describeDocker = process.env.DSERVE_DOCKER_TESTS ? describe : describe.skip;

describeDocker( 'tagLocalCommitImage against a real Docker daemon', () => {
	afterAll( async () => {
		for ( const tag of tagsToRemove ) {
			await docker
				.getImage( tag )
				.remove()
				.catch( (): undefined => undefined );
		}
	} );

	test(
		'tags the newest local image built from the commit',
		async () => {
			await buildImage( `${ REPO }:build-1`, SHA );
			await new Promise( resolve => setTimeout( resolve, CREATED_RESOLUTION ) );
			await buildImage( `${ REPO }:build-2`, SHA );
			await buildImage( `${ REPO }:build-3`, OTHER_SHA );
			await refreshLocalImages();

			const newest = await docker.getImage( `${ REPO }:build-2` ).inspect();
			const tagged = await tagLocalCommitImage( COMMIT_TAG );
			tagsToRemove.push( COMMIT_TAG );

			expect( tagged ).toBeDefined();
			expect( tagged.Id ).toBe( newest.Id );
			// The refresh inside tagLocalCommitImage sees the tag the daemon just applied.
			expect( getAllImages().get( COMMIT_TAG ).Id ).toBe( newest.Id );
			expect( ( await docker.getImage( COMMIT_TAG ).inspect() ).RepoTags ).toContain( COMMIT_TAG );
		},
		BUILD_TIMEOUT
	);

	test(
		'tags nothing when no local image was built from the commit',
		async () => {
			await buildImage( `${ REPO }:build-4`, OTHER_SHA );
			await refreshLocalImages();

			const unknownCommitTag = `${ REPO }:commit-${ 'b'.repeat( 40 ) }`;

			expect( await tagLocalCommitImage( unknownCommitTag ) ).toBeUndefined();
			await expect( docker.getImage( unknownCommitTag ).inspect() ).rejects.toThrow();
		},
		BUILD_TIMEOUT
	);
} );
