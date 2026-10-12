import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { backupTests } from '../ios-test-inventory.mjs';
import {
  executeBackupPhases,
  readBackupAttachment,
  recordingIdentifier,
} from '../backup-test-phases.mjs';

const recordingID = '11111111-2222-4333-8444-555555555555';

function fixture(fail) {
  const calls = [];
  const operations = {
    reset(options) {
      calls.push(['reset', options]);
    },
    run(identifier, id) {
      calls.push([identifier, id]);
      if (identifier === fail) throw new Error('first failure');
      return { recording: { recordingId: recordingID } };
    },
    snapshot(id) {
      calls.push(['snapshot', id]);
      return { owned: true };
    },
    restore(snapshot, id) {
      calls.push(['restore', snapshot, id]);
    },
    cleanup(snapshot) {
      calls.push(['cleanup', snapshot]);
    },
  };
  return { calls, operations };
}

test('runs all original backup requirements with fresh independent cases and a separate actual restore boundary', async () => {
  const value = fixture();
  assert.equal((await executeBackupPhases(value.operations)).length, 5);
  assert.deepEqual(
    value.calls.filter((call) => Array.isArray(call) && call[0] === 'reset').map((call) => call[1]),
    [false, false, false, false, true].map((preserveKeychain) => ({ preserveKeychain })),
  );
  assert.deepEqual(
    value.calls
      .filter(Array.isArray)
      .filter((call) => backupTests.includes(call[0]))
      .map((call) => call[0]),
    backupTests,
  );
  assert.deepEqual(value.calls.at(-2), [backupTests[4], recordingID]);
  assert.deepEqual(value.calls.at(-1), ['cleanup', { owned: true }]);
});

test('preserves first failures without retry or later resets and cleans only an allocated snapshot', async () => {
  const first = fixture(backupTests[0]);
  await assert.rejects(executeBackupPhases(first.operations), /first failure/);
  assert.deepEqual(first.calls, [
    ['reset', { preserveKeychain: false }],
    [backupTests[0], undefined],
  ]);
  const recovery = fixture(backupTests[4]);
  await assert.rejects(executeBackupPhases(recovery.operations), /first failure/);
  assert.deepEqual(recovery.calls.at(-1), ['cleanup', { owned: true }]);
});

test('requires the seeded and recovered recording identities to agree', async () => {
  assert.throws(() => recordingIdentifier({ recording: { recordingId: '../foreign' } }), /UUID/);
  const value = fixture();
  const run = value.operations.run;
  value.operations.run = (identifier, id) => {
    const result = run(identifier, id);
    return identifier === backupTests[4]
      ? { recording: { recordingId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } }
      : result;
  };
  await assert.rejects(executeBackupPhases(value.operations), /identity changed/);
});

test('reads only the exact observed result from the selected test and owned Simulator', () => {
  const root = mkdtempSync(join(tmpdir(), 'orot-backup-attachment-fixture-'));
  const attachment = {
    suggestedHumanReadableName: 'backup-snapshot-seed-observed-result_0.json',
    exportedFileName: recordingID + '.json',
    deviceId: recordingID,
  };
  const manifest = [
    {
      testIdentifier: backupTests[3].split('/').slice(1).join('/') + '()',
      attachments: [attachment],
    },
  ];
  const save = () => writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  try {
    save();
    writeFileSync(
      join(root, attachment.exportedFileName),
      JSON.stringify({ recording: { recordingId: recordingID } }),
    );
    assert.equal(
      recordingIdentifier(readBackupAttachment(root, backupTests[3], 'snapshot-seed', recordingID)),
      recordingID,
    );
    assert.throws(
      () => readBackupAttachment(root, backupTests[3], 'snapshot-seed', 'foreign'),
      /foreign/,
    );
    attachment.exportedFileName = '../foreign.json';
    save();
    assert.throws(
      () => readBackupAttachment(root, backupTests[3], 'snapshot-seed', recordingID),
      /path/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
