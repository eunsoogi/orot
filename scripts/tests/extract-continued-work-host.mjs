import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Compile the actual native method against platform doubles, never a copied algorithm.
// The explicit adjacent markers fail closed if production structure changes.
function sliceBetween(source, start, end) {
  assert.equal(source.split(start).length, 2);
  assert.equal(source.split(end).length, 2);
  assert.ok(source.indexOf(start) < source.indexOf(end));
  return source.split(start)[1].split(end)[0];
}

const nativeRoot = 'apps/mobile/ios/OrotMobile';
const method = sliceBetween(
  readFileSync(`${nativeRoot}/ConversationExecutionModule.swift`, 'utf8'),
  '    @objc(work:active:)\n',
  '    @objc(end:)\n',
);
assert.ok(method.startsWith('    func work('));

// The actual diagnostic uses Foundation only; don't pull the iOS scheduler
// class or its UIKit/BackgroundTasks imports into this host-only target.
const observer = sliceBetween(
  readFileSync(`${nativeRoot}/ConversationContinuedProcessing.swift`, 'utf8'),
  '/// Opt-in native result stages carry no request IDs, content, model, or error details.\n',
  '/// A user-submitted answer may continue with CPU/network access, never background GPU.\n',
);
assert.ok(observer.startsWith('enum ConversationExecutionStage:'));
assert.ok(observer.includes('func observeConversationExecution('));

writeFileSync(
  process.argv[2],
  `import Foundation\n${observer}extension ConversationExecutionModule {\n${method}}\n`,
);
