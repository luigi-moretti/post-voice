import { extractNarratableText } from '../../editor/extract-narratable-text';

describe( 'extractNarratableText', () => {
	it( 'includes paragraph and heading content, stripping inline markup', () => {
		const blocks = [
			{
				name: 'core/heading',
				attributes: { content: 'Title' },
				innerBlocks: [],
			},
			{
				name: 'core/paragraph',
				attributes: { content: 'Hello <strong>world</strong>.' },
				innerBlocks: [],
			},
		];
		expect( extractNarratableText( blocks ) ).toBe( 'Title Hello world.' );
	} );

	it( 'excludes code, table, gallery and custom HTML blocks', () => {
		const blocks = [
			{
				name: 'core/code',
				attributes: { content: 'const x = 1;' },
				innerBlocks: [],
			},
			{ name: 'core/table', attributes: {}, innerBlocks: [] },
			{ name: 'core/gallery', attributes: {}, innerBlocks: [] },
			{
				name: 'core/html',
				attributes: { content: '<div>raw</div>' },
				innerBlocks: [],
			},
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
							{
								name: 'core/list-item',
								attributes: { content: 'First item' },
								innerBlocks: [],
							},
							{
								name: 'core/list-item',
								attributes: { content: 'Second item' },
								innerBlocks: [],
							},
						],
					},
					{
						name: 'core/quote',
						attributes: {},
						innerBlocks: [
							{
								name: 'core/paragraph',
								attributes: { content: 'A quoted line.' },
								innerBlocks: [],
							},
						],
					},
				],
			},
		];
		expect( extractNarratableText( blocks ) ).toBe(
			'First item Second item A quoted line.'
		);
	} );

	it( 'collapses whitespace and trims the final result', () => {
		const blocks = [
			{
				name: 'core/paragraph',
				attributes: { content: '  spaced   out  ' },
				innerBlocks: [],
			},
		];
		expect( extractNarratableText( blocks ) ).toBe( 'spaced out' );
	} );

	it( 'decodes HTML entities so the engine never reads them aloud literally', () => {
		// WordPress escapes every & in saved content, and wptexturize() rewrites
		// straight quotes as &#8217; — so this is the common case, not an edge case.
		const blocks = [
			{
				name: 'core/paragraph',
				attributes: {
					content:
						'Tom &amp; Jerry&#8217;s caf&eacute; &hellip; 9&#8211;5',
				},
				innerBlocks: [],
			},
		];
		expect( extractNarratableText( blocks ) ).toBe(
			'Tom & Jerry’s caf&eacute; … 9–5'
		);
	} );

	it( 'strips tags before decoding, so escaped markup is not deleted as a tag', () => {
		const blocks = [
			{
				name: 'core/paragraph',
				attributes: { content: 'Use the &lt;strong&gt; tag' },
				innerBlocks: [],
			},
		];
		expect( extractNarratableText( blocks ) ).toBe(
			'Use the <strong> tag'
		);
	} );

	it( 'coerces non-string content instead of dropping the block', () => {
		// WordPress can hand back a RichTextData instance rather than a plain string.
		const richTextLike = { toString: () => 'From RichTextData' };
		const blocks = [
			{
				name: 'core/paragraph',
				attributes: { content: richTextLike },
				innerBlocks: [],
			},
		];
		expect( extractNarratableText( blocks ) ).toBe( 'From RichTextData' );
	} );
} );
