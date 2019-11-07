export function round( a: number, digits: number ): number {
	const scale = Math.pow( 10, digits );

	return Math.round( a * scale ) / scale;
}

export function percent( numerator: number, denominator: number ): number {
	return round( ( numerator / ( Number.EPSILON + denominator ) ) * 100, 2 );
}

export function splitTime( t: number, u: number, n: number ): [number, number] {
	const whole = Math.floor( t / ( u * n ) );
	const part = Math.round( ( t - whole * u * n ) / u );

	return [ whole, part ];
}

export function humanSize( size: number ): string {
	if ( size > 1024 ** 3 ) {
		return `${ round( size / 1024 ** 3, 2 ) } GB`;
	}

	if ( size > 1024 ** 2 ) {
		return `${ round( size / 1024 ** 2, 1 ) } MB`;
	}

	if ( size > 1024 ) {
		return `${ Math.round( size / 1024 ) } KB`;
	}

	return `${ size } B`;
}

const formatMs = (tic:number ) => tic + 'ms';

const formatSec = ( tic:number) => {
	const secs = ( tic / 1000 ).toFixed( 2 );
	return `${secs}s`;
}

const formatMin = ( tic: number  ) => {
	const mins = Math.floor( tic / ( 1000 * 60 ) );
	const secs = tic - mins * 60 * 1000;
	let str = mins + 'm';
	if ( secs > 0 ) {
		str += ' ' + formatSec( secs );
	}
	return str;
}

const formatHours = ( tic: number ) => {
	const hours = Math.floor( tic / ( 1000 * 60 * 24 ) );
	const mins = tic - hours * 1000 * 60 * 24;
	let str = hours + 'h';
	if ( mins > 0 ) {
		str += ' ' + formatMin( mins );
	}
	return str;
}


export function humanTimeSpan( tic: number ) : string {
	let negate = false;
	if ( tic < 0 ) {
		tic = -1 * tic;
		negate = true;
	}
	let span;
	if ( tic < 1000 ) {
		span = formatMs( tic );
	} else if ( tic < 1000 * 60 ) {
		span = formatSec( tic );
	} else if ( tic < 1000 * 60 * 24 ) {
		span = formatMin( tic );
	} else {
		span = formatHours( tic );
	}

	return ( negate ? '-' : '' ) + span;
}

export function humanRelativeTime( tic: number ): string {
	const toc = Date.now() / 1000;
	const span = toc - tic;

	if ( span < 60 ) {
		return `${ Math.round( span ) }s ago`;
	}

	if ( span < 60 * 60 ) {
		const [ m, s ] = splitTime( span, 60, 1 );

		return s ? `${ m }m ${ s }s ago` : `${ m }m ago`;
	}

	if ( span < 24 * 3600 ) {
		const [ h, m ] = splitTime( span, 60, 60 );

		return m ? `${ h }h ${ m }m ago` : `${ h }h ago`;
	}

	if ( span < 7 * 24 * 3600 ) {
		const [ d, h ] = splitTime( span, 3600, 24 );

		return h ? `${ d }d ${ h }h ago` : `${ d }d ago`;
	}

	if ( span < 30 * 7 * 24 * 3600 ) {
		const [ w, d ] = splitTime( span, 24 * 3600, 7 );

		return d ? `${ w }w ${ d }d ago` : `${ w }w ago`;
	}

	return `${ Math.round( span / ( 7 * 24 * 3600 ) ) }w ago`;
}

export function errorClass( errorLevel: number ): string {
	if ( errorLevel <= 10 ) {
		return 'trace';
	}

	if ( errorLevel <= 20 ) {
		return 'debug';
	}

	if ( errorLevel <= 30 ) {
		return 'info';
	}

	if ( errorLevel <= 40 ) {
		return 'warn';
	}

	if ( errorLevel <= 50 ) {
		return 'error';
	}

	return 'fatal';
}
