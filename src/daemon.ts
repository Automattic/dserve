import forever from 'forever-monitor';

import { l } from './logger';

const child = new forever.Monitor( 'build/index.js', {
	watch: false,
	silent: false,
	max: Infinity,
	minUptime: 2000,
} ) as any;

child.on( 'error', ( err: unknown ) => {
	l.error( { err }, 'forever: Error during run' );
} );

child.on( 'restart', () => {
	l.info( 'forever: Restarting' );
} );

child.on( 'exit:code', ( code: number, signal: string ) => {
	l.info( { code, signal }, 'forever: exited child', code, signal );
} );

child.on( 'exit', ( exitedChild: unknown, spinning: boolean ) => {
	l.info( { child: exitedChild, spinning }, 'forever: really exited', exitedChild, spinning );
} );

child.on( 'stop', ( childData: unknown ) => {
	l.info( { data: childData }, 'forever: child stopping' );
} );

child.start();
