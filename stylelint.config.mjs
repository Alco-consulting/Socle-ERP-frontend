/**
 * Stylelint guards the design tokens: no raw color outside `src/styles/_tokens.scss`.
 * Components use `var(--color-…)`; a new color is added as a token first.
 */
export default {
  customSyntax: 'postcss-scss',
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklch'],
    'declaration-no-important': true,
    'color-no-invalid-hex': true,
    'block-no-empty': true,
  },
  overrides: [
    {
      files: ['src/styles/_tokens.scss'],
      rules: {
        'color-no-hex': null,
        'function-disallowed-list': null,
      },
    },
  ],
};
