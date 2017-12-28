jest.mock('bunyan');

describe('logger', () => {
	let logger;
	let createLogger;
	beforeEach(() => {
		jest.clearAllMocks();
		jest.resetModules();
		logger = {
			info: jest.fn(),
			error: jest.fn(),
			child: jest.fn(options => ({ streams: options.streams })),
		};
		createLogger = () => logger;
	});

	describe('#closeLogger', () => {
		test('should close all of the streams in a logger logger', () => {});
	});

	describe('l', () => {
		test('should be an object with two functions: log and error', () => {
			const { l, closeLogger, getLoggerForBuild } = require('../src/logger');
			expect(l).toBeInstanceOf(Object);
			expect(l.log).toBeInstanceOf(Function);
			expect(l.error).toBeInstanceOf(Function);
		});

		test('should only make one base logger', () => {
			const bunyan = require('bunyan');
			const { l, closeLogger, getLoggerForBuild } = require('../src/logger');
			expect(bunyan.createLogger.mock.calls.length).toBe(1);
			expect(bunyan.createLogger.mock.instances.length).toBe(1);
		});

		test('l should call the underlying loggers info and error functions', () => {
			jest.setMock('bunyan', { createLogger });
			const { l, closeLogger, getLoggerForBuild } = require('../src/logger');

			l.log('testLog');
			l.error('testLog');

			expect(logger.info.mock.calls.length).toBe(1);
			expect(logger.error.mock.calls.length).toBe(1);
		});
	});

	describe('#getLoggerForBuild', () => {
		test('should make a child logger', () => {
			const bunyan = require('bunyan');
			const { l, closeLogger, getLoggerForBuild } = require('../src/logger');
			getLoggerForBuild('build-hash');
			expect(logger.child.mock.calls.length).toBe(1);
		});

		test('should write to a file at the correct path', () => {
			const bunyan = require('bunyan');
			const { l, closeLogger, getLoggerForBuild } = require('../src/logger');
			const childLogger = getLoggerForBuild('build-hash');
			expect(childLogger.streams).toEqual([
				{
					path: expect.stringContaining(
						'dserve-build-Automattic-wp-calypso-build-hash/dserve-build-log.txt'
					),
					type: 'file',
				},
			]);
		});
	});
});
