import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';

export default [
  // Apply to all JS/JSX files
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        sessionStorage: 'readonly',
        crypto: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        ClipboardItem: 'readonly',
        Blob: 'readonly',
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // ESLint recommended rules
      ...js.configs.recommended.rules,

      // React recommended rules
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,

      // React Hooks rules
      ...reactHooks.configs.recommended.rules,

      // React Refresh (Vite HMR)
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // React settings
      'react/react-in-jsx-scope': 'off', // Not needed with React 18
      'react/prop-types': 'off', // We're not using PropTypes
      'react/no-unescaped-entities': ['error', { forbid: ['>', '}'] }], // Allow apostrophes in text

      // Code quality
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off', // Allow console for development
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  // Node.js scripts (sensitivity analysis, CLI scripts, lambda functions)
  {
    files: [
      'sensitivity-analysis/**/*.js',
      'lambda/**/*.js',
      'lambda/**/*.mjs',
      'scripts/**/*.js',
      'legacy/**/*.js',
    ],
    languageOptions: {
      globals: {
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
  },
  // Disable ESLint rules that conflict with Prettier
  prettierConfig,
  // Ignore build output and dependencies
  {
    ignores: ['dist/', 'node_modules/', 'prototypes/', '.netlify/'],
  },
];
