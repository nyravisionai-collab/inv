const js = require('@eslint/js');
const globals = require('globals');

/**
 * Flat ESLint config for the CommonJS backend.
 *
 * `no-undef` is the important rule here: it catches a helper being used in a
 * module that never required it, which previously only surfaced at runtime.
 */
module.exports = [
  {
    ignores: ['node_modules/**', 'data/**', 'backups/**', 'uploads/**', 'logs/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_|^next$',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'no-console': 'off',
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',
      'no-var': 'error',
      // Guard against `catch (e) {}` silently swallowing failures; an empty
      // block must at least carry a comment explaining why.
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-empty': 'off',
    },
  },
  {
    /**
     * The lite client (public/lite) is browser code, not Node, and is
     * deliberately written in ES5 so it runs on Windows Phone IE11 and other
     * pre-ES6 handsets. `no-var`/`prefer-const` would demand exactly the
     * syntax those browsers cannot parse, so they are inverted here: `no-var`
     * is off and ES6+ syntax is rejected by `ecmaVersion: 5` instead.
     */
    files: ['public/lite/**/*.js'],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        Lite: 'writable',
      },
    },
    rules: {
      'no-var': 'off',
      'prefer-const': 'off',
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
    },
  },
];
