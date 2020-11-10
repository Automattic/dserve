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
	l.log( 'forever: Restarting' );
} );

child.on( 'exit:code', ( code, signal ) => {
	l.log( { code, signal }, 'forever: exited child', code, signal );
} );

child.on( 'exit', ( child, spinning ) => {
	l.log( { child, spinning }, 'forever: really exited', child, spinning );
} );

child.on( 'stop', childData => {
	l.log( { data: childData }, 'forever: child stopping' );
} );

child.start();
