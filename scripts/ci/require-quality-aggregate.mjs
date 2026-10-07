#!/usr/bin/env node

const partitions = [
  ['Linux portable quality', process.argv[2]],
  ['macOS Apple-tool quality', process.argv[3]],
];

if (process.argv.length !== 4) {
  throw new Error('Usage: node require-quality-aggregate.mjs <linux-result> <macos-result>');
}

for (const [name, result] of partitions) {
  // GitHub job results include skipped and cancelled; neither proves that a required partition ran.
  if (result !== 'success') {
    throw new Error(`${name} job must succeed; received ${JSON.stringify(result || 'missing')}`);
  }
}

console.log('Linux portable and macOS Apple-tool quality partitions passed.');
