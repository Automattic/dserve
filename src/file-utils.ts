import { access } from 'fs/promises';

/**
 * Resolves to whether anything exists at the given path.
 *
 * @param path - file or directory to check
 */
export async function pathExists( path: string ): Promise< boolean > {
	try {
		await access( path );
		return true;
	} catch {
		return false;
	}
}
