import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const CHECKER = resolve(dirname(fileURLToPath(import.meta.url)), '../check-loc.mjs');

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function put(root, name, content) {
  const file = join(root, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function repository(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orot-loc-'));
  try {
    git(root, 'init', '--quiet');
    git(root, 'config', 'user.email', 'loc-check@example.invalid');
    git(root, 'config', 'user.name', 'LOC Check Test');
    put(root, 'baseline.ts', 'base\n');
    for (const [name, content] of Object.entries(files)) put(root, name, content);
    git(root, 'add', '--all');
    git(root, 'commit', '--quiet', '-m', 'fixture base');
    return { root, base: git(root, 'rev-parse', 'HEAD') };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function physicalLines(count) {
  return `${Array.from({ length: count }, (_, index) => (index % 3 === 0 ? '// comment' : index % 3 === 1 ? '' : 'source();')).join('\n')}\n`;
}

function run(root, ...args) {
  const result = spawnSync(process.execPath, [CHECKER, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function clean(t, root) {
  t.after(() => rmSync(root, { recursive: true, force: true }));
}

test('exactly 250 physical lines pass and 251 fail', (t) => {
  const repo = repository();
  clean(t, repo.root);
  put(repo.root, 'src/boundary.ts', physicalLines(250));
  const passing = run(repo.root, '--base', repo.base);
  assert.equal(passing.status, 0, passing.output);
  assert.match(passing.output, /lines=250 limit=250/);

  put(repo.root, 'src/boundary.ts', physicalLines(251));
  const failing = run(repo.root, '--base', repo.base);
  assert.equal(failing.status, 1, failing.output);
  assert.match(failing.output, /FAIL UNTRACKED "src\/boundary\.ts" lines=251 limit=250/);
});

test('checks Ruby source extensions against the shared physical-line limit', (t) => {
  const repo = repository();
  clean(t, repo.root);
  const rubyPath = 'scripts/ci/cocoapods-null-byte-diagnostic.rb';
  put(repo.root, rubyPath, 'source\n'.repeat(251));
  const result = run(repo.root, '--base', repo.base);
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /FAIL UNTRACKED "scripts\/ci\/cocoapods-null-byte-diagnostic\.rb" lines=251 limit=250/,
  );
});

test('reports every over-limit changed path', (t) => {
  const repo = repository();
  clean(t, repo.root);
  put(repo.root, 'packages/domain/first.ts', physicalLines(251));
  put(repo.root, 'apps/mobile/__tests__/second.test.ts', physicalLines(252));
  const result = run(repo.root, '--base', repo.base);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /FAIL UNTRACKED "packages\/domain\/first\.ts" lines=251 limit=250/);
  assert.match(
    result.output,
    /FAIL UNTRACKED "apps\/mobile\/__tests__\/second\.test\.ts" lines=252 limit=250/,
  );
});

test('checks a committed integrated change from the supplied main base', (t) => {
  const repo = repository();
  clean(t, repo.root);
  put(repo.root, 'packages/domain/integrated.ts', physicalLines(251));
  git(repo.root, 'add', 'packages/domain/integrated.ts');
  git(repo.root, 'commit', '--quiet', '-m', 'integrate changed source');
  const result = run(repo.root, '--base', repo.base);
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /FAIL CHANGED "packages\/domain\/integrated\.ts" lines=251 limit=250/,
  );
});

test('checks main-push changes against the event before SHA instead of origin/main at HEAD', (t) => {
  const repo = repository();
  clean(t, repo.root);

  // A main push workflow checks out the new HEAD, so origin/main and HEAD already match.
  put(repo.root, 'packages/domain/pushed.ts', physicalLines(250));
  git(repo.root, 'add', 'packages/domain/pushed.ts');
  git(repo.root, 'commit', '--quiet', '-m', 'push compliant source');
  const compliantPushSha = git(repo.root, 'rev-parse', 'HEAD');
  git(repo.root, 'update-ref', 'refs/remotes/origin/main', compliantPushSha);

  const compliant = run(repo.root, '--base', repo.base);
  assert.equal(compliant.status, 0, compliant.output);
  assert.match(compliant.output, /lines=250 limit=250/);

  put(repo.root, 'packages/domain/pushed.ts', physicalLines(251));
  git(repo.root, 'add', 'packages/domain/pushed.ts');
  git(repo.root, 'commit', '--quiet', '-m', 'push oversized source');
  const oversizedPushSha = git(repo.root, 'rev-parse', 'HEAD');
  git(repo.root, 'update-ref', 'refs/remotes/origin/main', oversizedPushSha);

  const oldMergeBase = git(repo.root, 'merge-base', 'refs/remotes/origin/main', 'HEAD');
  assert.equal(oldMergeBase, oversizedPushSha);
  const skippedByHeadComparison = run(repo.root, '--base', oldMergeBase);
  assert.equal(skippedByHeadComparison.status, 0, skippedByHeadComparison.output);

  const checkedAgainstPushBefore = run(repo.root, '--base', compliantPushSha);
  assert.equal(checkedAgainstPushBefore.status, 1, checkedAgainstPushBefore.output);
  assert.match(
    checkedAgainstPushBefore.output,
    /FAIL CHANGED "packages\/domain\/pushed\.ts" lines=251 limit=250/,
  );
});

test('checks a renamed Unicode path and safely skips a deletion', (t) => {
  const repo = repository({ 'old source.ts': physicalLines(250), 'removed.ts': 'gone\n' });
  clean(t, repo.root);
  git(repo.root, 'mv', 'old source.ts', 'renamed ünicode.ts');
  git(repo.root, 'rm', 'removed.ts');
  const result = run(repo.root, '--base', repo.base);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /RENAMED from "old source\.ts" "renamed ünicode\.ts" lines=250/);
  assert.match(result.output, /DELETED "removed\.ts"/);
});

test('counts a Git-detected copy as a new current path', (t) => {
  const repo = repository({ 'source.ts': physicalLines(251) });
  clean(t, repo.root);
  copyFileSync(join(repo.root, 'source.ts'), join(repo.root, 'copy.ts'));
  git(repo.root, 'add', 'copy.ts');
  const result = run(repo.root, '--base', repo.base);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /COPIED from "source\.ts" "copy\.ts"/);
  assert.match(result.output, /FAIL COPIED from "source\.ts" "copy\.ts" lines=251 limit=250/);
});

test('reports policy exclusions with reasons', (t) => {
  const files = {
    'docs/releasing.md': 'prose\n'.repeat(300),
    'pnpm-lock.yaml': 'lock: value\n'.repeat(300),
    'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj': 'serialized\n'.repeat(300),
    'apps/mobile/ios/OrotMobile/Images.xcassets/Contents.json': '{}\n'.repeat(300),
    'build/generated.ts': 'generated\n'.repeat(300),
  };
  const repo = repository(files);
  clean(t, repo.root);
  for (const [name, content] of Object.entries(files)) put(repo.root, name, `${content}changed\n`);
  const result = run(repo.root, '--base', repo.base);
  assert.equal(result.status, 0, result.output);
  for (const name of Object.keys(files))
    assert.ok(result.output.includes(`EXCLUDED ${JSON.stringify(name)} reason=`), result.output);
});

test('classifies literal path segments and preserves a leading BOM in path names', (t) => {
  const bomName = '\uFEFFsame.ts';
  const repo = repository({ 'same.ts': 'small baseline\n' });
  clean(t, repo.root);
  const names = ['src/constructor/large.ts', 'src/__proto__/large.ts', 'scripts/build', bomName];
  for (const name of names) put(repo.root, name, physicalLines(251));
  chmodSync(join(repo.root, 'scripts/build'), 0o755);

  const result = run(repo.root, '--base', repo.base);
  assert.equal(result.status, 1, result.output);
  for (const name of names) {
    const shownName = JSON.stringify(name).replace(/\uFEFF/g, '\\uFEFF');
    assert.ok(
      result.output.includes(`FAIL UNTRACKED ${shownName} lines=251 limit=250`),
      result.output,
    );
  }
});

test('fails closed for unknown types, symlinks, and a missing base', (t) => {
  const repo = repository({ 'target.ts': 'safe\n' });
  clean(t, repo.root);
  put(repo.root, 'new.unknown', 'content\n');
  symlinkSync('target.ts', join(repo.root, 'linked.ts'));
  assert.ok(lstatSync(join(repo.root, 'linked.ts')).isSymbolicLink());
  git(repo.root, 'add', 'linked.ts');
  const fileResult = run(repo.root, '--base', repo.base);
  assert.equal(fileResult.status, 1, fileResult.output);
  assert.match(fileResult.output, /new\.unknown.*unclassified file type/);
  assert.match(fileResult.output, /linked\.ts.*unexpected Git file mode 120000/);

  const missing = run(repo.root, '--base', 'f'.repeat(40));
  assert.equal(missing.status, 1, missing.output);
  assert.match(missing.output, /cannot determine required files/);
  const omitted = run(repo.root);
  assert.equal(omitted.status, 1, omitted.output);
  assert.match(omitted.output, /provide exactly one of --base/);
});

test('--all reports pre-existing eligible violations and exclusions', (t) => {
  const repo = repository({
    'legacy/oversized.ts': 'line\n'.repeat(251),
    'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj': 'serialized\n'.repeat(494),
  });
  clean(t, repo.root);
  const result = run(repo.root, '--all');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /FAIL AUDIT "legacy\/oversized\.ts" lines=251 limit=250/);
  assert.match(result.output, /EXCLUDED .*project\.pbxproj.*serialized Xcode project metadata/i);
});
