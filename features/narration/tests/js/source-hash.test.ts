import { computeSourceHash } from '../../editor/source-hash';

describe( 'computeSourceHash', () => {
  it( 'produces a 64-character lowercase hex SHA-256 digest', async () => {
    const hash = await computeSourceHash( 'hello world' );
    expect( hash ).toMatch( /^[0-9a-f]{64}$/ );
  } );

  it( 'is deterministic for the same input', async () => {
    const a = await computeSourceHash( 'same text' );
    const b = await computeSourceHash( 'same text' );
    expect( a ).toBe( b );
  } );

  it( 'changes when input changes', async () => {
    const a = await computeSourceHash( 'text A' );
    const b = await computeSourceHash( 'text B' );
    expect( a ).not.toBe( b );
  } );
} );
