import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock( 'bunyan', () => ( {
	default: {
		createLogger: vi.fn( () => ( {
			info: () => {},
			warn: () => {},
			error: () => {},
		} ) ),
		RingBuffer: vi.fn(),
	},
} ) );

describe( 'logger', () => {
	let logger: any;
	let createLogger: any;
	beforeEach( () => {
		vi.clearAllMocks();
		vi.resetModules();
		logger = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			child: vi.fn( options => ( { streams: options.streams } ) ),
		};
		createLogger = () => logger;
	} );

	describe( '#closeLogger', () => {
		test( 'should close all of the streams in a logger logger', () => {} );
	} );

	describe( 'l', () => {
		test( 'should only make one base logger', async () => {
			const { default: bunyan } = ( await import( 'bunyan' ) ) as any;
			await import( '../src/logger' );
			expect( bunyan.createLogger.mock.calls.length ).toBe( 1 );
			expect( bunyan.createLogger.mock.instances.length ).toBe( 1 );
		} );

		test( 'l should call the underlying loggers info and error functions', async () => {
			vi.doMock( 'bunyan', () => ( { default: { createLogger, RingBuffer: vi.fn() } } ) );
			const { l } = await import( '../src/logger' );

			l.info( 'testLog' );
			l.warn( 'testLog' );
			l.error( 'testLog' );

			expect( logger.info.mock.calls.length ).toBe( 1 );
			expect( logger.warn.mock.calls.length ).toBe( 1 );
			expect( logger.error.mock.calls.length ).toBe( 1 );
		} );
	} );

	describe( '#getLoggerForBuild', () => {
		test( 'should make a child logger', async () => {
			const { getLoggerForBuild } = await import( '../src/logger' );
			getLoggerForBuild( 'build-hash' );
			expect( logger.child.mock.calls.length ).toBe( 1 );
		} );

		test( 'should write to a file at the correct path', async () => {
			const { getLoggerForBuild } = await import( '../src/logger' );
			const childLogger = getLoggerForBuild( 'build-hash' );
			expect( childLogger.streams ).toEqual( [
				{
					path: expect.stringContaining(
						'dserve-build-Automattic-wp-calypso-build-hash/dserve-build-log.txt'
					),
					type: 'file',
				},
			] );
		} );
	} );
} );
