import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localModelTests } from '../ios-test-inventory.mjs';
import { executeLocalModelPhases, readLocalModelAttachment } from '../local-model-test-phases.mjs';

function fixture({ failureIndex = -1, sameProcess = false, wrongMode = false } = {}) {
  const calls = [];
  let index = 0;
  return {
    calls,
    operations: {
      reset() {
        calls.push('reset');
      },
      run(identifier) {
        calls.push(identifier);
        const phase = index++;
        if (phase === failureIndex) throw new Error('actual first phase failure');
        return {
          hostProcessIdentifier: sameProcess ? 10 : 10 + phase,
          result: {
            mode: wrongMode ? 'unknown' : ['fresh', 'restart', 'indexed', 'reopened'][phase],
          },
        };
      },
    },
  };
}

test('keeps each original model corpus across a measured process restart and resets only between independent corpora', async () => {
  const value = fixture();
  assert.equal((await executeLocalModelPhases(value.operations)).length, 4);
  assert.deepEqual(value.calls, [
    'reset',
    ...localModelTests.slice(0, 2),
    'reset',
    ...localModelTests.slice(2),
  ]);
});

test('preserves the first failure and rejects same-process or wrong-mode persistence claims', async () => {
  for (const options of [{ failureIndex: 0 }, { sameProcess: true }, { wrongMode: true }]) {
    const value = fixture(options);
    await assert.rejects(executeLocalModelPhases(value.operations));
    assert.equal(value.calls.filter((call) => call === 'reset').length, 1);
    assert.ok(value.calls.length <= 3);
  }
});

test('accepts only one exact-case receipt from the owned device and a bounded exported filename', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-model-attachment-'));
  const identifier = localModelTests[0];
  const attachment = {
    suggestedHumanReadableName: 'local-model-observed-result_example.json',
    exportedFileName: '11111111-2222-4333-8444-555555555555.json',
    deviceId: 'owned-device',
  };
  const entry = {
    testIdentifier: identifier.split('/').slice(1).join('/') + '()',
    attachments: [attachment],
  };
  try {
    writeFileSync(join(directory, attachment.exportedFileName), JSON.stringify({ observed: true }));
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify([entry]));
    assert.deepEqual(readLocalModelAttachment(directory, identifier, 'owned-device'), {
      observed: true,
    });
    assert.throws(() => readLocalModelAttachment(directory, identifier, 'foreign-device'));
    assert.throws(() => readLocalModelAttachment(directory, localModelTests[1], 'owned-device'));
    for (const changed of [
      { ...entry, attachments: [attachment, attachment] },
      { ...entry, attachments: [{ ...attachment, exportedFileName: '../foreign.json' }] },
    ]) {
      writeFileSync(join(directory, 'manifest.json'), JSON.stringify([changed]));
      assert.throws(() => readLocalModelAttachment(directory, identifier, 'owned-device'));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
