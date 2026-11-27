import { describe, expect, it } from 'vitest';

// Temporary: checks that CI fails when a test fails. Remove before merging.
describe( 'CI canary', () => {
	it( 'fails on purpose', () => {
		expect( 1 + 1 ).toBe( 3 );
	} );
} );
