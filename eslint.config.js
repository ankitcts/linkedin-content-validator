import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    // Extension source runs in the browser / web-extension context.
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
  },
  {
    // Tooling and tests run in Node.
    files: ['test/**/*.js', 'scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // The hosted backend proxy runs on Vercel's Node runtime (ESM).
    files: ['proxy/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        TextEncoder: 'readonly',
      },
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '.claude/**', 'proxy/node_modules/**'],
  },
];
