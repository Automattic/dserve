import { execFile } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify( execFile );
const GIT_MAX_BUFFER = 10 * 1024 * 1024;
const gitEnv = {
	...process.env,
	GIT_TERMINAL_PROMPT: '0',
};

type GitCommandOptions = {
	cwd?: string;
};

async function isGitRepo( repoDir: string ) {
	try {
		await runGit( [ 'rev-parse', '--git-dir' ], { cwd: repoDir } );
		return true;
	} catch {
		return false;
	}
}

async function runGit(
	args: string[],
	options: GitCommandOptions = {}
): Promise< { stdout: string; stderr: string } > {
	try {
		return await execFileAsync( 'git', args, {
			cwd: options.cwd,
			env: gitEnv,
			maxBuffer: GIT_MAX_BUFFER,
		} );
	} catch ( err ) {
		err.message = `git ${ args.join( ' ' ) } failed: ${ err.message }`;
		throw err;
	}
}

export async function ensureRepoCloned( remoteUrl: string, repoDir: string ) {
	await fs.ensureDir( path.dirname( repoDir ) );
	if ( await isGitRepo( repoDir ) ) {
		return;
	}

	if ( await fs.pathExists( repoDir ) ) {
		await fs.remove( repoDir );
	}

	await runGit( [ 'clone', '--no-checkout', remoteUrl, repoDir ] );
}

export async function cloneRepo( sourceDir: string, repoDir: string ) {
	await runGit( [ 'clone', '--no-checkout', sourceDir, repoDir ] );
}

export async function fetchRemoteBranches( repoDir: string, remote = 'origin' ) {
	await runGit( [ 'fetch', '--prune', remote ], { cwd: repoDir } );
}

export function parseRemoteBranchRefs( refs: string ) {
	return new Map(
		refs
			.split( '\n' )
			.map( line => line.trim() )
			.filter( Boolean )
			.map( line => line.split( '\t' ) as [ string, string ] )
			.filter( ( [ refName ] ) => refName.startsWith( 'origin/' ) && refName !== 'origin/HEAD' )
			.map(
				( [ refName, commitHash ] ) =>
					[ refName.replace( 'origin/', '' ), commitHash ] as [ string, string ]
			)
	);
}

export async function listRemoteBranches( repoDir: string ) {
	const { stdout } = await runGit(
		[
			'for-each-ref',
			'--format=%(refname:short)\t%(objectname)',
			'refs/remotes/origin',
		],
		{ cwd: repoDir }
	);

	return parseRemoteBranchRefs( stdout );
}

export async function hasCommit( repoDir: string, commitHash: string ) {
	try {
		await runGit( [ 'cat-file', '-e', `${ commitHash }^{commit}` ], { cwd: repoDir } );
		return true;
	} catch {
		return false;
	}
}

export async function checkoutCommit( repoDir: string, commitHash: string ) {
	await runGit(
		[ '-c', 'advice.detachedHead=false', 'checkout', '--force', '--detach', commitHash ],
		{ cwd: repoDir }
	);
}

export async function gcRepo( repoDir: string ) {
	await runGit( [ 'gc' ], { cwd: repoDir } );
}
