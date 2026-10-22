/**
 * Stylelint guards the design tokens: no raw color, radius, timing, layer or font size outside
 * `src/styles/_tokens.scss`, and no gradient (the charte asks for flat surfaces). Components
 * use `var(--…)`; a new value is added as a token first. Inline component styles are checked
 * too (scripts/stylelint-inline.mjs).
 */
const GRADIENTS = ['linear-gradient', 'radial-gradient', 'conic-gradient', 'repeating-linear-gradient'];
const COLOR_FUNCTIONS = ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklch'];

export default {
  customSyntax: 'postcss-scss',
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': [...COLOR_FUNCTIONS, ...GRADIENTS],
    'declaration-no-important': true,
    'color-no-invalid-hex': true,
    'block-no-empty': true,
    'declaration-property-value-disallowed-list': {
      // 0 and 50 % (circles) stay allowed; a length is a token.
      '/^border(-.*)?-radius$/': ['/\\d(px|rem|em)/'],
      'z-index': ['/^-?\\d+$/'],
      'font-size': ['/^\\d/'],
      '/^(transition|animation)(-duration|-delay)?$/': ['/\\d(m?s)\\b/'],
    },
  },
  overrides: [
    {
      files: ['src/styles/_tokens.scss'],
      rules: {
        'color-no-hex': null,
        'function-disallowed-list': null,
        'declaration-property-value-disallowed-list': null,
      },
    },
    {
      // Drawing, not decoration: the select's chevron and the skeleton's shimmer.
      files: ['src/styles/_forms.scss', 'src/app/shared/ui/loading/loading.scss'],
      rules: { 'function-disallowed-list': COLOR_FUNCTIONS },
    },
  ],
};
