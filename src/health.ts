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
