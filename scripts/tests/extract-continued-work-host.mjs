import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Compile the actual native method against platform doubles, never a copied algorithm.
// The explicit adjacent method markers fail closed if production structure changes.
const source = readFileSync('apps/mobile/ios/OrotMobile/ConversationExecutionModule.swift', 'utf8');
const start = '    @objc(work:active:)\n';
const end = '    @objc(end:)\n';
assert.equal(source.split(start).length, 2);
assert.equal(source.split(end).length, 2);
const method = source.split(start)[1].split(end)[0];
assert.ok(method.startsWith('    func work('));
writeFileSync(
  process.argv[2],
  'import Foundation\nextension ConversationExecutionModule {\n' + method + '}\n',
);
