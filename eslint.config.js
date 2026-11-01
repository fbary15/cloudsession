import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'dist/', 'travel/vendor/'] },
  js.configs.recommended,
  {
    files: ['puzzle/**/*.js', 'workout/**/*.js', 'travel/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['workout/sw.js', 'travel/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ['test/**/*.js', 'scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
];
