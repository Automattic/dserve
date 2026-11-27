import bunyan from 'bunyan';
import { Writable } from 'stream';

import { CommitHash, getImageName } from './api';
import { getLogPath } from './builder';
import { config } from './config';

export const ringbuffer = new bunyan.RingBuffer( { limit: 1000 } );

const dserveLogger = bunyan.createLogger( {
	name: 'dserve',
	streams: [
		{
			type: 'rotating-file',
			path: './logs/log.txt',
			period: '1d',
			count: 7,
		},
		{
			level: bunyan.DEBUG,
			type: 'raw',
			stream: ringbuffer as any,
		},
		{
			stream: process.stdout,
			level: bunyan.DEBUG,
		},
	],
	serializers: bunyan.stdSerializers, // allows one to use err, req, and res as special keys
	src: true,
} );

/* super convenient name */
export const l = dserveLogger;

/**
 * Creates a child logger that outputs to the build directory and
 * outputs errors to the console.
 *
 * @param commitHash - hash to make logger for
 */
export function getLoggerForBuild( commitHash: CommitHash ) {
	const path = getLogPath( commitHash );
	const logger = dserveLogger.child( {
		streams: [
			{
				type: 'file',
				path,
			},
			{
				stream: process.stdout,
				level: bunyan.INFO,
			},
		],
		commitHash,
		imageName: getImageName( commitHash ),
	} ) as LoggerWithStreams;

	// we want it to be a child so that
	// it inherits al the same properties as the parent
	// except we don't want any of the parents streams
	// so this line removes them all
	logger.streams = logger.streams.filter( stream => stream.path === path );

	return logger;
}

/**
 * A stream as bunyan stores it on a logger. File streams keep their path.
 */
type LoggerStream = { stream: Writable; type: string; path?: string };

/**
 * A bunyan logger with its streams, which bunyan's type definitions leave out.
 */
type LoggerWithStreams = bunyan & { streams: LoggerStream[] };

export function closeLogger( logger: LoggerWithStreams ) {
	logger.streams.forEach( stream => {
		stream.stream.end();
	} );
}
