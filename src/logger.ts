import bunyan from 'bunyan';
import _ from 'lodash';
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
			stream: ringbuffer,
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
	} );

	// we want it to be a child so that
	// it inherits al the same properties as the parent
	// except we don't want any of the parents streams
	// so this line removes them all
	// @ts-ignore this needs to be fixed with proper typing
	( ( logger as any ) as Logger ).streams = _.filter( ( logger as any ).streams, { path } );

	return logger;
}

type Logger = { streams: Array< { stream: Writable; type: string } > };
export function closeLogger( logger: Logger ) {
	logger.streams.forEach( stream => {
		stream.stream.end();
	} );
}
