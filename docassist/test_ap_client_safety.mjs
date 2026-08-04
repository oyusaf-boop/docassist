import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

assert.doesNotMatch(source, /processLabPlaceholders/);
assert.doesNotMatch(source, /\{\{(?:TROP_|BNP_PROMPT|DDIMER_PROMPT)/);
assert.doesNotMatch(source, /Physician writes? (?:the )?diagnosis manually/i);
assert.doesNotMatch(source, /institutional (?:URL|ULN)\s*=\s*20/i);

console.log('client A&P safety assertions passed');
