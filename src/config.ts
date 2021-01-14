import Dockerode from 'dockerode';
import { DockerRepository, RunEnv } from './api';

type Readonly< T > = { readonly [ P in keyof T ]: T[ P ] };
type AppConfig = Readonly< {
	build: BuildConfig;
	repo: RepoConfig;
	envs: EnvsConfig;
	allowedDockerRepositories: AllowedDockerRepositories;
	allowedLabels: AllowedLabels;
	proxyRetry: number;
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

type EnvsConfig = Readonly< RunEnv[] >;

type AllowedDockerRepositories = Readonly< DockerRepository[] >;

type AllowedLabels = Readonly< Record< string, string > >;

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

	allowedDockerRepositories: [ 'registry.a8c.com' ],

	allowedLabels: {
		'com.a8c.image-builder': 'teamcity',
	},

	// When the proxy to the container fails with a ECONNRESET error, retry this number
	// of times.
	proxyRetry: 3,
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
			};
	}
}
