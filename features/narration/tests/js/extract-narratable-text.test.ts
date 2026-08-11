import { extractNarratableText } from '../../editor/extract-narratable-text';

describe( 'extractNarratableText', () => {
  it( 'includes paragraph and heading content, stripping inline markup', () => {
    const blocks = [
      { name: 'core/heading', attributes: { content: 'Title' }, innerBlocks: [] },
      { name: 'core/paragraph', attributes: { content: 'Hello <strong>world</strong>.' }, innerBlocks: [] },
    ];
    expect( extractNarratableText( blocks ) ).toBe( 'Title Hello world.' );
  } );

  it( 'excludes code, table, gallery and custom HTML blocks', () => {
    const blocks = [
      { name: 'core/code', attributes: { content: 'const x = 1;' }, innerBlocks: [] },
      { name: 'core/table', attributes: {}, innerBlocks: [] },
      { name: 'core/gallery', attributes: {}, innerBlocks: [] },
      { name: 'core/html', attributes: { content: '<div>raw</div>' }, innerBlocks: [] },
    ];
    expect( extractNarratableText( blocks ) ).toBe( '' );
  } );

  it( 'recurses into list items and quotes nested inside a group block', () => {
    const blocks = [
      {
        name: 'core/group',
        attributes: {},
        innerBlocks: [
          {
            name: 'core/list',
            attributes: {},
            innerBlocks: [
              { name: 'core/list-item', attributes: { content: 'First item' }, innerBlocks: [] },
              { name: 'core/list-item', attributes: { content: 'Second item' }, innerBlocks: [] },
            ],
          },
          {
            name: 'core/quote',
            attributes: {},
            innerBlocks: [
              { name: 'core/paragraph', attributes: { content: 'A quoted line.' }, innerBlocks: [] },
            ],
          },
        ],
      },
    ];
    expect( extractNarratableText( blocks ) ).toBe( 'First item Second item A quoted line.' );
  } );

  it( 'collapses whitespace and trims the final result', () => {
    const blocks = [
      { name: 'core/paragraph', attributes: { content: '  spaced   out  ' }, innerBlocks: [] },
    ];
    expect( extractNarratableText( blocks ) ).toBe( 'spaced out' );
  } );
} );
