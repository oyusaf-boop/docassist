import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const start = source.indexOf('const settled = await allSettledWithConcurrency([');
const end = source.indexOf('], 2, (result) => {', start);

assert.notEqual(start, -1, 'analysis task queue exists');
assert.notEqual(end, -1, 'analysis task queue keeps the two-request limit');

const queue = source.slice(start, end);
const positions = {
  cdi: queue.indexOf("callAPI('cdi'"),
  optimizedAp: queue.indexOf("callAPI('optimized_ap'"),
  em: queue.indexOf("callAPI('em'"),
  sepsis: queue.indexOf("callAPI('sepsis'"),
};

for (const [task, position] of Object.entries(positions)) {
  assert.notEqual(position, -1, `${task} remains in the analysis queue`);
}

assert.ok(
  positions.cdi < positions.em && positions.optimizedAp < positions.em,
  'CDI and Optimized A&P occupy the first two worker slots',
);
assert.ok(
  positions.cdi < positions.sepsis && positions.optimizedAp < positions.sepsis,
  'shorter extraction work follows the long-running tasks',
);

assert.match(source, /const cdiP = takeResult\(settled\[0\], 'CDI'\)/);
assert.match(source, /const apP = takeAP\(settled\[1\]\)/);
assert.match(source, /const emP = takeResult\(settled\[2\], 'E&M'\)/);
assert.match(source, /const sepP = takeResult\(settled\[3\], 'Sepsis'\)/);

console.log('latency scheduling assertions passed');
