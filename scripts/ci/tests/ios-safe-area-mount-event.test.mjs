import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const patch = readFileSync(
  new URL('../../../vendor/patches/react-native-safe-area-context@5.10.1.patch', import.meta.url),
  'utf8',
);
const additions = patch
  .split('\n')
  .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
  .map((line) => line.slice(1))
  .join('\n');

// This source contract protects the pinned native lifecycle patch; it is not a substitute for Simulator evidence.
test('safe-area mount replays real insets once after attachment', () => {
  assert.match(additions, /#if !TARGET_OS_OSX[\s\S]*- \(void\)didMoveToWindow/);
  assert.match(additions, /\[super didMoveToWindow\];[\s\S]*generation = \+\+_mountGeneration/);
  assert.equal((additions.match(/dispatch_async\(/g) ?? []).length, 1);
  assert.match(additions, /dispatch_get_main_queue\(\)/);
  assert.match(
    additions,
    /strongSelf->_initialInsetsSent = NO;\s*\[strongSelf invalidateSafeAreaInsets\];/,
  );
  assert.doesNotMatch(additions, /dispatch_after|NSTimer|initialMetrics|UIEdgeInsetsZero/);
});

test('queued inset replay cannot mutate recycled, unmounted, or reparented views', () => {
  assert.match(additions, /__weak RNCSafeAreaProviderComponentView \*weakSelf = self/);
  assert.match(additions, /__weak typeof\(self.window\) mountWindow = self.window/);
  assert.match(additions, /__weak UIView \*mountSuperview = self.superview/);
  assert.match(additions, /strongSelf == nil \|\| strongSelf->_mountGeneration != generation/);
  assert.match(additions, /strongSelf.window == nil/);
  assert.match(
    additions,
    /strongSelf.window != mountWindow \|\| strongSelf.superview != mountSuperview/,
  );
  assert.match(patch, /- \(void\)prepareForRecycle\n \{\n\+  \+\+_mountGeneration;/);
});

// pnpm consumes the patch bytes as an installation/build input.
test('safe-area patch and lockfile use the same content hash', () => {
  const lock = readFileSync(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8');
  const hash = createHash('sha256').update(patch).digest('hex');
  assert.ok(lock.includes(`react-native-safe-area-context@5.10.1: ${hash}`));
  assert.ok(lock.includes(`react-native-safe-area-context@5.10.1(patch_hash=${hash})`));
});
