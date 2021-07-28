import forever from 'forever-monitor';

import { l } from './logger';

const child = new forever.Monitor( 'build/index.js', {
	watch: false,
	silent: false,
	max: Infinity,
	minUptime: 2000,
} );

child.on( 'error', err => {
	l.error( { err }, 'forever: Error during run' );
} );

child.on( 'restart', () => {
	l.info( 'forever: Restarting' );
} );

child.on( 'exit:code', ( code, signal ) => {
	l.info( { code, signal }, 'forever: exited child', code, signal );
} );

child.on( 'exit', ( child, spinning ) => {
	l.info( { child, spinning }, 'forever: really exited', child, spinning );
} );

child.on( 'stop', childData => {
	l.info( { data: childData }, 'forever: child stopping' );
} );

child.start();
