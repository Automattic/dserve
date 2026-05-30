import { ChildProcess, spawn } from 'child_process';

import { l } from './logger';

const childScript = 'build/index.js';
const minUptime = 2000;

let stopping = false;
let child: ChildProcess | undefined;

function stop( signal: NodeJS.Signals ) {
	stopping = true;
	if ( child && ! child.killed ) {
		child.kill( signal );
	}
}

function start() {
	const startedAt = Date.now();
	child = spawn( process.execPath, [ childScript ], {
		stdio: 'inherit',
	} );

	l.info( { pid: child.pid }, 'daemon: started child process' );

	child.on( 'error', ( err: unknown ) => {
		l.error( { err }, 'daemon: child process error' );
	} );

	child.on( 'exit', ( code: number | null, signal: NodeJS.Signals | null ) => {
		const uptime = Date.now() - startedAt;
		l.info( { code, signal, uptime }, 'daemon: child process exited' );

		if ( stopping ) {
			return;
		}

		const restartDelay = uptime < minUptime ? minUptime : 0;
		setTimeout( start, restartDelay );
	} );
}

process.on( 'SIGINT', () => stop( 'SIGINT' ) );
process.on( 'SIGTERM', () => stop( 'SIGTERM' ) );

start();
