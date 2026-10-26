import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

const gate = resolve('scripts/ci/fail-on-warning.mjs');
const pinnedCocoaPodsPhaseNotices = [
  '[!] React-Core-prebuilt has added 1 script phase. Please inspect before executing a build. See `https://guides.cocoapods.org/syntax/podspec.html#script_phases` for more information.',
  '[!] ReactNativeDependencies has added 1 script phase. Please inspect before executing a build. See `https://guides.cocoapods.org/syntax/podspec.html#script_phases` for more information.',
  '[!] hermes-engine has added 1 script phase. Please inspect before executing a build. See `https://guides.cocoapods.org/syntax/podspec.html#script_phases` for more information.',
];

function runGate(source) {
  return spawnSync(process.execPath, [gate, '--', process.execPath, '-e', source], {
    cwd: resolve('.'),
    encoding: 'utf8',
  });
}

test('accepts and preserves exactly the three pinned React Native CocoaPods phase notices', () => {
  const output = `${pinnedCocoaPodsPhaseNotices.join('\n')}\n`;
  const result = runGate(`process.stdout.write(${JSON.stringify(output)});`);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, output);
  assert.match(
    result.stderr,
    /IOS_WARNING_GATE occurrences=3 accepted=3 blocking=0 child_status=0 signal=none result=passed/,
  );
});

test('keeps incomplete, duplicate, and changed CocoaPods phase notices blocking', () => {
  const scenarios = [
    pinnedCocoaPodsPhaseNotices.slice(0, 2),
    [...pinnedCocoaPodsPhaseNotices, pinnedCocoaPodsPhaseNotices[0]],
    ...[
      pinnedCocoaPodsPhaseNotices[0].replace('React-Core-prebuilt', 'OtherPod'),
      pinnedCocoaPodsPhaseNotices[1].replace('added 1 script phase', 'added 2 script phases'),
      pinnedCocoaPodsPhaseNotices[2].replace(
        'Please inspect before executing a build',
        'Please inspect before building',
      ),
    ].map((changedNotice, index) =>
      pinnedCocoaPodsPhaseNotices.map((notice, noticeIndex) =>
        noticeIndex === index ? changedNotice : notice,
      ),
    ),
  ];

  for (const notices of scenarios) {
    const output = `${notices.join('\n')}\n`;
    const result = runGate(`process.stdout.write(${JSON.stringify(output)});`);

    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, output);
    assert.match(
      result.stderr,
      new RegExp(
        `IOS_WARNING_GATE occurrences=${notices.length} accepted=0 blocking=${notices.length} child_status=0 signal=none result=failed`,
      ),
    );
  }
});

test('keeps unrelated CocoaPods and compiler diagnostics blocking beside accepted phase notices', () => {
  const unrelated =
    '[!] OtherPod has added 1 script phase. Please inspect before executing a build.';
  const output = `${[...pinnedCocoaPodsPhaseNotices, unrelated, 'SwiftCompile: warning: unrelated diagnostic'].join('\n')}\n`;
  const result = runGate(`process.stdout.write(${JSON.stringify(output)});`);

  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, output);
  assert.match(
    result.stderr,
    /IOS_WARNING_GATE occurrences=5 accepted=3 blocking=2 child_status=0 signal=none result=failed/,
  );
});
