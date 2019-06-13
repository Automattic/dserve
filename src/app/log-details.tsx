import * as React from 'react'; 

const interestingDetails = new Set( [
	'buildImageTime',
	'checkoutTime',
	'cloneTime',
	'code',
	'commitHash',
	'containerId',
	'data',
	'err',
	'error',
	'freePort',
	'imageName',
	'reason',
	'signal',
	'success',
] );

const LogDetails = ( { data, details }: any,  ) => {
  details = details || interestingDetails;
	const detailsToShow = new Map();
	for ( let detail of details ) {
		if ( data[ detail ] ) {
			detailsToShow.set( detail, data[ detail ] );
		}
	}
	if ( detailsToShow.size === 0 ) {
		return null;
	}
	return (
		<div className="details">
			{ Array.from( detailsToShow.entries() ).map( ( [ key, value ] ) => (
				<pre key={ key }>
					{ key }:{' '}
					{ typeof value === 'object' ? JSON.stringify( value, null, 2 ) : value.toString() }
				</pre>
			) ) }
		</div>
	);
};

export default LogDetails;