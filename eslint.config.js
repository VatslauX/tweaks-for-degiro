// Lint for mistakes only (unused code, undefined names); tsc checks types, style is free.
const js = require('@eslint/js');
const globals = require('globals');

// globals that flags.js and common.js define for the other scripts
const shared = { __dgt: 'readonly', dgAlarmRules: 'readonly', dgAlarmStore: 'readonly', dgAlarmPanel: 'readonly', dgUi: 'readonly' };
const flags = Object.fromEntries(['DG_DEFAULTS', 'DG_TX_COLUMNS', 'DG_ORDER_COLUMNS', 'DG_MAX_TITLES', 'DG_MAX_TITLE_LEN', 'DG_PAGE_FLAGS',
  'dgListeners', 'dgOnSettings', 'dgSanitize', 'dgSettings'].map(k => [k, 'readonly']));

module.exports = [
  { ignores: ['node_modules/', 'dist/', 'test-results/', 'playwright-report/', '.claude/'] },
  js.configs.recommended,
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, ...shared, ...flags, chrome: 'readonly', module: 'readonly', Highcharts: 'readonly' }
    },
    rules: {
      'no-unused-vars': ['error', { caughtErrors: 'none', vars: 'local' }], // top-level = shared with other scripts
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-redeclare': ['error', { builtinGlobals: false }] // flags.js declares the flag globals
    }
  },
  {
    // Node, plus browser code inside page.evaluate()
    files: ['tests/**/*.js', 'scripts/**/*.js', '*.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser, ...shared, ...flags, chrome: 'readonly', Highcharts: 'readonly' }
    },
    rules: {
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-empty-pattern': 'off' // Playwright fixtures take ({}, use)
    }
  }
];
