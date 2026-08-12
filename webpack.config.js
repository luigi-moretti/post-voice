const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const path = require( 'path' );

module.exports = {
  ...defaultConfig,
  entry: {
    'narration-editor': path.resolve( __dirname, 'features/narration/editor/index.tsx' ),
    'narration-player': path.resolve( __dirname, 'features/narration/frontend/player.ts' ),
  },
  output: {
    ...defaultConfig.output,
    path: path.resolve( __dirname, 'build' ),
  },
  resolve: {
    ...defaultConfig.resolve,
    fallback: {
      ...( defaultConfig.resolve?.fallback || {} ),
      // The vendored sentencepiece.js is an Emscripten build that carries its
      // Node branch alongside its browser one, including `await import('module')`
      // to build a `require`. That branch is unreachable in a worker, but webpack
      // still resolves the specifier at build time and fails. `false` compiles it
      // to an empty module instead of pulling in a Node polyfill.
      module: false,
    },
  },
};
