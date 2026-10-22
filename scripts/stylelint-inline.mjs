// Stylelint on the inline `styles` of components (`styles: \`…\``), which the SCSS glob of
// `npm run lint` never sees: same rules as the stylesheets (stylelint.config.mjs).
import { globSync, readFileSync } from 'node:fs';
import stylelint from 'stylelint';

const files = globSync('src/app/**/*.ts').filter((file) => !file.endsWith('.spec.ts'));
let failed = false;
let checked = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const found = /\bstyles:\s*\[?\s*`([\s\S]*?)`/.exec(source);
  if (!found) {
    continue;
  }
  checked += 1;
  const line = source.slice(0, found.index).split('\n').length;
  const { results } = await stylelint.lint({ code: found[1], codeFilename: `${file}.scss` });
  for (const warning of results[0].warnings) {
    failed = true;
    console.error(`${file}:${line + warning.line - 1}  ${warning.text}`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`Inline styles: ${checked} components checked, no problem.`);
}
