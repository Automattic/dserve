import { StatsD } from 'hot-shots';

const statsd = new StatsD( {
	host: process.env.STATSD_HOST || 'localhost',
	port: +process.env.STATSD_POST || 8125,
} );

export function increment( stat: string ) {
	statsd.increment( `stats.counts.dserve.${ stat }` );
}

export function decrement( stat: string ) {
	statsd.decrement( `stats.counts.dserve.${ stat }` );
}

export function gauge( stat: string, value: number ) {
	statsd.gauge( `stats.gauges.dserve.${ stat }`, value );
}

export function timing( stat: string, value: number ) {
	statsd.timing( `stats.timers.dserve.${ stat }`, value );
}
