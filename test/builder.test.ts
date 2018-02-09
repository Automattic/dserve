import * as _ from 'lodash';

import { addToBuildQueue, buildFromQueue, MAX_CONCURRENT_BUILDS } from '../src/builder';
import { CommitHash } from '../src/api';
jest.mock('../src/logger');

describe('builder', () => {
	const toAdd = { commitHash: 'hash', branch: 'branch' };
	describe('addToBuildQueue', () => {
		test('should add to an empty queue', () => {
			const queue = [];
			addToBuildQueue(toAdd, queue, new Set());
			expect(queue).toEqual([toAdd]);
		});

		test('should not add to a queue if already in it', () => {
			const sameHashOtherBranch = { ...toAdd, branch: 'other-branch' };
			const queue = [sameHashOtherBranch];
			addToBuildQueue(toAdd, queue, new Set());
			expect(queue).toEqual([sameHashOtherBranch]);
		});

		test('should not add to queue if build is under way', () => {
			const queue = [];
			addToBuildQueue(toAdd, queue, new Set(['hash']));
			expect(queue).toEqual([]);
		});
	});

	describe('buildFromQueue', () => {
		test('should not throw when buildQueue is empt', () => {
			buildFromQueue({ buildQueue: [] });
		});

		test('should remove hash from the queue once building it', () => {
			const buildQueue = [toAdd];
			buildFromQueue({ buildQueue });
			expect(buildQueue).toEqual([]);
		});

		test('should not build anything if already at capacity', () => {
			const buildQueue = [toAdd];
			const currentBuilds = new Set(_.range(MAX_CONCURRENT_BUILDS));

			buildFromQueue({ buildQueue, currentBuilds });
			expect(buildQueue).toEqual([toAdd]);
		});

		test('should remove hash from curent builds once building is complete', done => {
			async function instaBuilder(
				{ commitHash, branch }: { commitHash: CommitHash; branch: string },
				{ onBuildComplete }
			) {
				onBuildComplete();
				expect(Array.from(currentBuilds.values())).toEqual([]);
				done();
			}

			const buildQueue = [toAdd];
			const currentBuilds = new Set(['hash']);
			buildFromQueue({ buildQueue, currentBuilds, builder: instaBuilder });
		});
	});
});
