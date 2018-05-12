import * as Dockerode from 'dockerode';

type Readonly<T> = {
    readonly [P in keyof T]: T[P];
}
type AppConfig = Readonly<{
    build: BuildConfig;
    repo: RepoConfig;
}>;

type BuildConfig = Readonly<{
    containerCreateOptions?: Dockerode.ContainerCreateOptions;
    exposedPort: number;
    logFilename: string;
    tagPrefix: string;
}>;

type RepoConfig = Readonly<{
    project: string;
}>;

export const config: AppConfig = {
    build: {
        containerCreateOptions: {
            Env: [ 'NODE_ENV=wpcalypso', 'CALYPSO_ENV=wpcalypso'],
        },
        exposedPort: 3000,
        logFilename: 'dserve-build-log.txt',
        tagPrefix: 'dserve-wpcalypso'
    },

    repo: {
        project: 'Automattic/wp-calypso'
    },
};