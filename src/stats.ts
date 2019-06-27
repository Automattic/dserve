import { StatsD } from 'hot-shots';

const statsd = new StatsD( {
	host: process.env.STATSD_HOST || 'localhost',
	port: +process.env.STATSD_PORT || 8125,
} );

export function increment( stat: string ) {
	statsd.increment( `dserve.${ stat }` );
}

export function decrement( stat: string ) {
	statsd.decrement( `dserve.${ stat }` );
}

export function gauge( stat: string, value: number ) {
	statsd.gauge( `dserve.${ stat }`, value );
}

export function timing( stat: string, value: number ) {
	statsd.timing( `dserve.${ stat }`, value );
}
