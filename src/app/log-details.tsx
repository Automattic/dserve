import * as React from 'react';
import { humanTimeSpan } from './util';

const interestingDetails = new Set( [
	'buildConcurrency',
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

const serialize = ( value: any, key: string ) => {
	switch ( key ) {
		case 'buildImageTime':
		case 'checkoutTime':
		case 'cloneTime':
			return humanTimeSpan( +value );
		case 'commitHash':
			return (
				<React.Fragment>
					<a href={ `/?hash=${ value }` } title={ value }>
						{ value.substr( 0, 8 ) }
					</a>{' '}
					<a href={ `https://github.com/Automattic/wp-calypso/commit/${ value }` }>(github)</a>
				</React.Fragment>
			);
		default:
			return typeof value === 'object' ? JSON.stringify( value, null, 2 ) : value.toString();
	}
};

const LogDetails = ( { data, details }: any ) => {
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
					{ key }: { serialize( value, key ) }
				</pre>
			) ) }
		</div>
	);
};

export default LogDetails;
