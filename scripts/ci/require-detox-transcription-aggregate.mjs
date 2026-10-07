#!/usr/bin/env node

const args = process.argv.slice(2);
if (args.length !== 4) {
  throw new Error(
    'Usage: node require-detox-transcription-aggregate.mjs <job-result> <profile> <test-cases> <test-suites>',
  );
}

// Keep this one native-configuration probe separate from the nine-case performance inventory.
if (args[0] !== 'success') {
  throw new Error(
    `Speech Transcription child job must succeed; received ${JSON.stringify(args[0] || 'missing')}`,
  );
}
if (args[1] !== 'transcription') {
  throw new Error(
    `Speech Transcription child output must identify transcription; received ${JSON.stringify(args[1] || 'missing')}`,
  );
}
for (const [kind, value] of [
  ['test cases', args[2]],
  ['Jest suites', args[3]],
]) {
  if (!/^(0|[1-9]\d*)$/.test(value ?? '') || Number(value) !== 1) {
    throw new Error(
      `Speech Transcription child output must report exactly 1 ${kind}; received ${JSON.stringify(value || 'missing')}`,
    );
  }
}

console.log('1/1 Speech Transcription test passed in its isolated native configuration');
