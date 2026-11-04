import { config, envContainerConfig } from '../src/config';

describe( 'envContainerConfig', () => {
	it.each( [
		[ 'calypso', 'horizon' ],
		[ 'jetpack', 'jetpack-cloud-horizon' ],
		[ 'a8c-for-agencies', 'a8c-for-agencies-horizon' ],
		[ 'dashboard', 'dashboard-horizon' ],
		[ 'dashboard-a4a', 'dashboard-horizon' ],
	] )( 'runs the %s env with the %s config', ( env, calypsoEnv ) => {
		expect( envContainerConfig( env as any ).Env ).toEqual( [
			`NODE_ENV=${ calypsoEnv }`,
			`CALYPSO_ENV=${ calypsoEnv }`,
		] );
	} );

	it( 'covers every configured env', () => {
		expect( config.envs ).toEqual( [
			'calypso',
			'jetpack',
			'a8c-for-agencies',
			'dashboard',
			'dashboard-a4a',
		] );
	} );

	it( 'falls back to the horizon config for unknown envs', () => {
		expect( envContainerConfig( 'unknown' as any ).Env ).toEqual( [
			'NODE_ENV=horizon',
			'CALYPSO_ENV=horizon',
		] );
	} );
} );
