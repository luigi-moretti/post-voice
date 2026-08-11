const defaultConfig = require( '@wordpress/scripts/config/jest-unit.config' );

module.exports = {
  ...defaultConfig,
  setupFiles: [ ...( defaultConfig.setupFiles || [] ), '<rootDir>/test/jest.setup.js' ],
  // The default @wordpress/jest-preset-default testMatch includes `**/test/*.[jt]s?(x)`,
  // which would otherwise pick up test/jest.setup.js itself as a test suite (and fail
  // with "Your test suite must contain at least one test"). Excluded explicitly here.
  testPathIgnorePatterns: [ '/node_modules/', '<rootDir>/vendor/', '<rootDir>/test/jest.setup.js' ],
  collectCoverageFrom: [
    'features/narration/editor/extract-narratable-text.ts',
    'features/narration/editor/source-hash.ts',
    'features/narration/editor/rtf-calibration.ts',
    'features/narration/editor/storage-check.ts',
    'features/narration/editor/mp3-encoder.ts',
    'features/narration/editor/model-source.ts',
    'features/narration/frontend/player-state.ts',
  ],
  coverageThreshold: {
    global: { lines: 80 },
  },
};
