import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReleaseNotes, parseCommitLog, readCommitList } from '../changelog.mjs';
import { sourceSha } from './fixtures.mjs';

test('parses commit subjects and validates full hashes', () => {
  assert.deepEqual(parseCommitLog(`${sourceSha}\0first commit\n`), [
    { sha: sourceSha, subject: 'first commit' },
  ]);
  assert.throws(() => parseCommitLog('not-a-sha\0bad commit'), /full SHA/);
});

test('reads full history for the first release and a previous-tag range afterward', () => {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    return { status: 0, stdout: `${sourceSha}\0change\n` };
  };
  readCommitList(sourceSha, null, run);
  readCommitList(sourceSha, 'b'.repeat(40), run);
  assert.deepEqual(calls[0][1], ['log', '--reverse', '--format=%H%x00%s', sourceSha]);
  assert.equal(calls[1][1].at(-1), `${'b'.repeat(40)}..${sourceSha}`);
});

test('builds exact-version release notes with usable commit links and explicit limitations', () => {
  const notes = buildReleaseNotes({
    version: '0.1.0',
    sourceSha,
    previousTag: null,
    commits: [{ sha: sourceSha, subject: 'fix [release] (notes)' }],
  });
  assert.match(notes, /^# Orot 0\.1\.0/m);
  assert.match(notes, new RegExp(`https://github.com/eunsoogi/orot/commit/${sourceSha}`));
  assert.ok(notes.includes('fix \\[release\\] \\(notes\\)'));
  assert.match(notes, /physical-device behavior|physical-device/i);
  assert.match(notes, /TestFlight and App Store distribution remain deferred to issue #174/);
  assert.doesNotMatch(notes, /# Orot v0\.1\.0/);
});
