export type RouteFacts = {
	commitHash: string;
	runEnv: string;
	hasLocally: boolean;
	isCurrentlyBuilding: boolean;
	isRunning: boolean;
	isHealthy: boolean;
	didFail: boolean;
	shouldReset: boolean;
	acceptsHtml: boolean;
};

export type RouteAction =
	| { kind: 'reset' }
	| { kind: 'proxy' }
	| { kind: 'loading'; message: string }
	| { kind: 'not-ready' }
	| { kind: 'show-build-log' }
	| { kind: 'enqueue-build' }
	| { kind: 'start-container' };

export function decideRouteAction( facts: RouteFacts ): RouteAction {
	if ( facts.shouldReset ) {
		return { kind: 'reset' };
	}

	if ( facts.isRunning ) {
		if ( facts.isHealthy ) {
			return { kind: 'proxy' };
		}
		if ( facts.acceptsHtml ) {
			return {
				kind: 'loading',
				message: 'Starting container, this page will refresh shortly',
			};
		}
		return { kind: 'not-ready' };
	}

	if ( facts.isCurrentlyBuilding ) {
		return { kind: 'show-build-log' };
	}

	if ( ! facts.hasLocally ) {
		return { kind: 'enqueue-build' };
	}

	return { kind: 'start-container' };
}
