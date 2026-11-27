import { vi } from 'vitest';

// Stops tests from sending metrics: src/stats creates a StatsD client when it's loaded.
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
