/**
 * Reports translation gaps so they are caught in review rather than by a user.
 *
 * Checks:
 *   1. keys present in `en` but missing from `gu` (or left untranslated)
 *   2. keys passed to t() in the source that are missing from the dictionary
 *   3. dictionary keys that nothing references any more
 *
 * Exit code is non-zero only for (1) and (2); unused keys are informational.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');

const { translations } = await import(join(srcDir, 'utils', 'translations.js'));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.jsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// Collect every literal passed to t('...').
const used = new Set();
const T_CALL = /\bt\(\s*'((?:[^'\\\\]|\\\\.)*)'\s*\)/g;

for (const file of walk(srcDir)) {
  if (file.includes(join('utils', 'translations.js'))) continue;
  const code = readFileSync(file, 'utf8');
  let m;
  while ((m = T_CALL.exec(code))) {
    used.add(m[1].replace(/\\'/g, "'"));
  }
}

// Some strings reach t() indirectly and would otherwise look unused:
//   - navigation labels are translated from a config array in Layout.jsx
//   - apiError.js maps server codes to translation keys
const apiErrorSrc = readFileSync(join(srcDir, 'utils', 'apiError.js'), 'utf8');
for (const m of apiErrorSrc.matchAll(/^\s*ERR_[A-Z_]+:\s*'([^']+)',/gm)) {
  used.add(m[1]);
}
const layoutSrc = readFileSync(join(srcDir, 'components', 'Layout.jsx'), 'utf8');
for (const m of layoutSrc.matchAll(/(?:label|title|section):\s*'([^']+)'/g)) {
  used.add(m[1]);
}

// Fallback keys handed to apiErrorMessage(err, t, 'Fallback') and to
// Dashboard's stat-card config are translated inside those helpers.
for (const file of walk(srcDir)) {
  const code = readFileSync(file, 'utf8');
  for (const m of code.matchAll(/apiErrorMessage\([^,]+,\s*t,\s*'([^']+)'\)/g)) {
    used.add(m[1]);
  }
  for (const m of code.matchAll(/(?:label|title):\s*'([^']+)'/g)) {
    used.add(m[1]);
  }
}

const en = translations.en || {};
const gu = translations.gu || {};

// Acronyms, symbols, and strings already written in Gujarati are legitimately
// identical in both dictionaries.
const GUJARATI = /[\u0A80-\u0AFF]/;
const isSameInBoth = (key) => /^[A-Z0-9 &/%.#-]+$/.test(key) || GUJARATI.test(key);

const missingFromDict = [...used].filter((k) => !(k in en)).sort();
const missingGu = Object.keys(en).filter((k) => !(k in gu)).sort();
const untranslated = Object.keys(en)
  .filter((k) => k in gu && gu[k] === en[k] && !isSameInBoth(k))
  .sort();
const unused = Object.keys(en).filter((k) => !used.has(k)).sort();

const report = (title, items) => {
  if (!items.length) return;
  console.log(`\n${title} (${items.length}):`);
  for (const i of items) console.log(`  - ${i}`);
};

console.log(`i18n: ${Object.keys(en).length} keys, ${used.size} referenced in source`);
report('Used in source but missing from dictionary', missingFromDict);
report('Present in en but missing from gu', missingGu);
report('Identical in en and gu (likely untranslated)', untranslated);
report('In dictionary but never used', unused);

const failures = missingFromDict.length + missingGu.length + untranslated.length;
if (failures) {
  console.error(`\ni18n check failed: ${failures} issue(s)`);
  process.exit(1);
}
console.log('\ni18n check passed');
