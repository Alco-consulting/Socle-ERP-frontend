// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

/** Dependency direction: shared ← core ← features (and app.* composes everything). */
const restrictedImports = (patterns) => ['error', { patterns }];

module.exports = tseslint.config(
  { ignores: ['dist/', 'coverage/', '.angular/', 'e2e/.results/', 'playwright-report/'] },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/component-selector': [
        'error',
        { type: ['element', 'attribute'], prefix: 'alco', style: 'kebab-case' },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'alco', style: 'camelCase' },
      ],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
    },
  },
  {
    files: ['src/app/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports([
        {
          regex: String.raw`^(\.\./)+(core|features)/`,
          message: 'shared ne dépend ni de core ni des features.',
        },
      ]),
    },
  },
  {
    files: ['src/app/core/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports([
        { regex: String.raw`^(\.\./)+features/`, message: 'core ne dépend d’aucune feature.' },
      ]),
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {},
  },
  {
    // Test hosts and scenarios: brevity over production rules.
    files: ['**/*.spec.ts', 'e2e/**/*.ts', '*.config.ts'],
    rules: {
      '@angular-eslint/prefer-on-push-component-change-detection': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
