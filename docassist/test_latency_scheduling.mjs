import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
assert.doesNotMatch(source, /callAPI\('clinical_bundle', context\)/);
assert.match(source, /callAPI\('clinical_core', context\)/);
assert.match(source, /callAPI\('optimized_ap'/);
assert.match(source, /allSettledWithConcurrency\(clinicalTasks, 2, \(result\) => \{/);
assert.match(source, /get\('clinical_bundle'\) !== '0'/);
assert.match(source, /callAPI\('em', context\)/);
assert.match(source, /callAPI\('cdi', context\)/);
assert.match(source, /callAPI\('sepsis', context\)/);
assert.match(source, /const emP = useSplitClinical \? clinicalP/);
assert.match(source, /const cdiP = useSplitClinical \? takeResult\(settled\[2\], 'CDI'\)/);
assert.match(source, /const sepP = useSplitClinical \? clinicalP/);

console.log('clinical bundle scheduling assertions passed');
