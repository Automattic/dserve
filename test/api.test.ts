import {
	getCommitAccessTime,
	touchCommit,
	getExpiredContainers,
	CONTAINER_EXPIRY_TIME,
	getImageName,
} from '../src/api';

describe('api', () => {
	describe('getExpiredContainers', () => {
		const RealNow = Date.now;
		Date.now = () => 1000000;
		afterAll(() => {
			Date.now = RealNow;
		});

		const EXPIRED_TIME = Date.now() - CONTAINER_EXPIRY_TIME - 1;
		const GOOD_TIME = Date.now() - CONTAINER_EXPIRY_TIME + 1;
		const images = [{ Image: getImageName('1') }, { Image: getImageName('2') }];

		test('returns nothing for empty list of containers', () => {
			expect(getExpiredContainers([], () => 0)).toEqual([]);
		});

		test('returns the whole list if everything is expired', () => {
			expect(getExpiredContainers(images as any, () => CONTAINER_EXPIRY_TIME)).toEqual(images);
		});

		test('returns empty list if everything is before expiry', () => {
			expect(getExpiredContainers(images as any, () => GOOD_TIME)).toEqual([]);
		});

		test('returns list of only images that have not expired', () => {
			const getAccessTime = jest
				.fn()
				.mockReturnValueOnce(EXPIRED_TIME)
				.mockReturnValueOnce(GOOD_TIME);
			expect(getExpiredContainers(images as any, getAccessTime)).toEqual([].concat(images[0]));
		});
	});

	describe('commitAccessTimes', () => {
		beforeEach(() => {
			jest.resetModules();
		});
		test('should return undefined for non-existent hash', () => {
			expect(getCommitAccessTime('nanana')).toBe(undefined);
		});

		test('should return a date for touched commit', () => {
			touchCommit('touched');
			expect(getCommitAccessTime('touched')).toEqual(expect.any(Number));
		});

		test('should return same time for a commit that doesnt get touched again', () => {
			touchCommit('touched');
			const touch1 = getCommitAccessTime('touched');
			touchCommit('nanan');
			expect(getCommitAccessTime('touched')).toBe(touch1);
		});

		test('should update a commit touch date to be newer if called again', () => {
			const RealNow = Date.now;

			let count = 0;
			Date.now = jest.fn().mockImplementation(() => count++);

			touchCommit('touched');
			const touch1 = getCommitAccessTime('touched');
			touchCommit('touched');
			const touch2 = getCommitAccessTime('touched');
			expect(touch2).toBeGreaterThan(touch1);

			Date.now = RealNow;
		});
	});
});
