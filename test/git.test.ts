import { describe, expect, test, vi } from 'vitest';

vi.mock( 'hot-shots', () => ( {
	// A function, not an arrow, as dserve constructs it with `new`.
	StatsD: vi.fn( function () {
		return {
			increment: vi.fn(),
			decrement: vi.fn(),
			gauge: vi.fn(),
			timing: vi.fn(),
		};
	} ),
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
