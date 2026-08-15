// Ensure Response is available in jsdom environment for cache-related tests.
// jsdom 22 doesn't provide Response globally by default. Provide a minimal
// Response class that satisfies cache storage tests.
if ( typeof global.Response === 'undefined' ) {
	// eslint-disable-next-line no-undef
	global.Response = class Response {
		constructor( body, init ) {
			this.body = body;
			this.status = ( init && init.status ) || 200;
			this.statusText = ( init && init.statusText ) || 'OK';
			this.headers = new Map( ( init && init.headers ) || [] );
		}
	};
}
