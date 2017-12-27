import { addToBuildQueue, buildFromQueue } from '../src/builder';
import { CommitHash } from '../src/api';
jest.mock('../src/logger');

describe('builder', () => {
	describe('addToBuildQueue', () => {
		test('should add to an empty queue', () => {
			const queue = [];
			addToBuildQueue('hash', queue, new Set());
			expect(queue).toEqual(['hash']);
		});

		test('should not add to a queue if already in it', () => {
			const queue = ['hash'];
			addToBuildQueue('hash', queue, new Set());
			expect(queue).toEqual(['hash']);
		});

		test('should not add to queue if build is under way', () => {
			const queue = [];
			addToBuildQueue('hash', queue, new Set(['hash']));
			expect(queue).toEqual([]);
		});
	});

	describe('buildFromQueue', () => {
		test('should not throw when buildQueue is empt', () => {
			buildFromQueue({ buildQueue: [] });
		});

		test('should remove hash from the queue once building it', () => {
			const buildQueue = ['hash'];
			buildFromQueue({ buildQueue });
			expect(buildQueue).toEqual([]);
		});

		test('should remove hash from curent builds once building is complete', done => {
			const instaBuilder = (hash: CommitHash, { onBuildComplete }) => {
				onBuildComplete();
				expect(Array.from(currentBuilds.values())).toEqual([]);
				done();
			};

			const buildQueue = ['hash'];
			const currentBuilds = new Set(buildQueue);
			buildFromQueue({ buildQueue, currentBuilds, builder: instaBuilder });
		});
	});
});
