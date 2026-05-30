const { spawnSync } = require( 'child_process' );

const yarnBin = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
const audit = spawnSync( yarnBin, [ 'audit', '--json', '--level', 'critical' ], {
	encoding: 'utf8',
} );

if ( audit.stderr ) {
	process.stderr.write( audit.stderr );
}

const lines = audit.stdout
	.split( /\r?\n/ )
	.map( line => line.trim() )
	.filter( Boolean );

let summary;
let parseFailed = false;

for ( const line of lines ) {
	try {
		const message = JSON.parse( line );
		if ( message.type === 'auditSummary' ) {
			summary = message.data;
		}
		if ( message.type === 'error' ) {
			process.stderr.write( `${ message.data }\n` );
		}
	} catch ( error ) {
		parseFailed = true;
		process.stdout.write( `${ line }\n` );
	}
}

if ( ! summary || parseFailed ) {
	process.stderr.write( 'Unable to read Yarn audit summary.\n' );
	process.exit( audit.status || 1 );
}

const vulnerabilities = summary.vulnerabilities || {};
const criticalCount = vulnerabilities.critical || 0;

process.stdout.write(
	`Critical vulnerabilities: ${ criticalCount }\n` +
		`Audit summary: ${ JSON.stringify( vulnerabilities ) }\n`
);

if ( criticalCount > 0 ) {
	process.exit( 1 );
}
