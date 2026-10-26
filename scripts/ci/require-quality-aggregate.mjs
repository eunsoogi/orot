#!/usr/bin/env node

if (process.argv.length !== 3) {
  throw new Error('Usage: node require-quality-aggregate.mjs <linux-result>');
}

const result = process.argv[2];
// GitHub job results include skipped and cancelled; neither proves the required Linux job ran.
if (result !== 'success') {
  throw new Error(
    `Linux quality job must succeed; received ${JSON.stringify(result || 'missing')}`,
  );
}

console.log('Linux quality partition passed.');
