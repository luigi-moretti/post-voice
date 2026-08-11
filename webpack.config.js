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
};
