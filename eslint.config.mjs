// ESLint flat config (ESLint 9+). Lints the TypeScript sources only; the
// build (tsc) is the source of truth for type correctness.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'spike-auth.js', 'homebridge-ui/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // TypeScript already resolves identifiers; `no-undef` would false-flag
      // Node/DOM globals (Buffer, fetch, setTimeout, …).
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'no-console': 'off',
    },
  },
);
