import Dockerode from 'dockerode';
import { RunEnv } from './api';

type Readonly< T > = { readonly [ P in keyof T ]: T[ P ] };
type AppConfig = Readonly< {
	build: BuildConfig;
	repo: RepoConfig;
	envs: EnvsConfig;
} >;

type BuildConfig = Readonly< {
	containerCreateOptions?: Dockerode.ContainerCreateOptions;
	exposedPort: number;
	logFilename: string;
	tagPrefix: string;
} >;

type RepoConfig = Readonly< {
	project: string;
} >;

type EnvsConfig = Readonly<RunEnv[]>;

export const config: AppConfig = {
	build: {
		containerCreateOptions: {},
		exposedPort: 3000,
		logFilename: 'dserve-build-log.txt',
		tagPrefix: 'dserve-wpcalypso',
	},

	repo: {
		project: 'Automattic/wp-calypso',
	},

	envs: [ 'calypso', 'jetpack' ],
};

export function envContainerConfig( environment: RunEnv ): Dockerode.ContainerCreateOptions {
	switch ( environment ) {
		case 'calypso':
		default:
			return {
				Env: [ 'NODE_ENV=wpcalypso', 'CALYPSO_ENV=wpcalypso' ],
			};
		case 'jetpack':
			return {
				Env: [ 'NODE_ENV=jetpack-cloud-horizon', 'CALYPSO_ENV=jetpack-cloud-horizon' ],
			}
	}
}