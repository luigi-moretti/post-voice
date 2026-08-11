export async function computeSourceHash( text: string ): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode( text );
  const digest = await crypto.subtle.digest( 'SHA-256', data );
  return Array.from( new Uint8Array( digest ) )
    .map( ( b ) => b.toString( 16 ).padStart( 2, '0' ) )
    .join( '' );
}
