import { addToBuildQueue } from '../src/builder';

describe('builder', () => {
	describe('addToBuildQueue', () => {
		test('should add to an empty queue', () => {
			const queue = [];
			addToBuildQueue('hash', queue, new Set());
			expect(queue).toEqual(['hash']);
		});
	});
});
