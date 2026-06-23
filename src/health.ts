export type HealthFetchImpl = (
	url: string,
	init?: { timeout?: number }
) => Promise< { status: number } >;

export type ProbeOptions = {
	fetchImpl: HealthFetchImpl;
	healthPath: string;
	timeoutMs: number;
};

export async function probeContainerHealth(
	port: number,
	options: ProbeOptions
): Promise< boolean > {
	const url = `http://127.0.0.1:${ port }${ options.healthPath }`;
	try {
		const response = await options.fetchImpl( url, { timeout: options.timeoutMs } );
		return response.status === 200;
	} catch ( err ) {
		return false;
	}
}

export type PollOptions = {
	port: number;
	fetchImpl: HealthFetchImpl;
	healthPath: string;
	intervalMs: number;
	ceilingMs: number;
	probeTimeoutMs: number;
	shouldAbort?: () => boolean;
	now?: () => number;
};

export type PollOutcome = 'healthy' | 'ceiling-exceeded' | 'aborted';

export async function pollUntilHealthy( options: PollOptions ): Promise< PollOutcome > {
	const now = options.now || ( () => Date.now() );
	const startedAt = now();

	const sleep = ( ms: number ) =>
		new Promise< void >( resolve => {
			setTimeout( resolve, ms );
		} );

	while ( true ) {
		if ( options.shouldAbort && options.shouldAbort() ) {
			return 'aborted';
		}

		const healthy = await probeContainerHealth( options.port, {
			fetchImpl: options.fetchImpl,
			healthPath: options.healthPath,
			timeoutMs: options.probeTimeoutMs,
		} );

		if ( healthy ) {
			return 'healthy';
		}

		if ( now() - startedAt >= options.ceilingMs ) {
			return 'ceiling-exceeded';
		}

		await sleep( options.intervalMs );
	}
}
