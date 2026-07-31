import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
assert.doesNotMatch(source, /callAPI\('clinical_bundle', context\)/);
assert.match(source, /callAPI\('clinical_analysis', context\)/);
assert.match(source, /get\('local_engine'\) !== '0'/);
assert.match(source, /callAPI\('clinical_core', context\)/);
assert.match(source, /callAPI\('optimized_ap'/);
assert.match(source, /async function generateAPOnDemand\(\)/);
assert.match(source, /allSettledWithConcurrency\(clinicalTasks, 2, \(result\) => \{/);
assert.match(source, /get\('clinical_bundle'\) !== '0'/);
assert.match(source, /callAPI\('em', context\)/);
assert.match(source, /callAPI\('cdi', context\)/);
assert.match(source, /callAPI\('sepsis', context\)/);
assert.match(source, /const emP = useLocalEngine \? localP/);
assert.match(source, /const cdiP = useLocalEngine \? localP/);
assert.match(source, /const sepP = useLocalEngine \? localP/);

console.log('clinical bundle scheduling assertions passed');
