jest.mock( 'hot-shots', () => ( {
	StatsD: jest.fn( () => ( {
		increment: jest.fn(),
		decrement: jest.fn(),
		gauge: jest.fn(),
		timing: jest.fn(),
	} ) ),
} ) );

import { parseRemoteBranchRefs } from '../src/git';

describe( 'git', () => {
	describe( 'parseRemoteBranchRefs', () => {
		test( 'keeps origin branches and skips origin HEAD', () => {
			expect(
				parseRemoteBranchRefs(
					[
						'origin/HEAD\t1111111',
						'origin/trunk\t2222222',
						'origin/add/feature\t3333333',
					].join( '\n' )
				)
			).toEqual(
				new Map( [
					[ 'trunk', '2222222' ],
					[ 'add/feature', '3333333' ],
				] )
			);
		} );
	} );
} );
