import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { speechJourneyTests } from '../ios-test-config.mjs';
import {
  executeSpeechJourneyPhases,
  readSpeechJourneyAttachment,
} from '../speech-journey-test-phases.mjs';

const first = {
  processIdentifier: 11,
  processInstance: '11111111-2222-4333-8444-555555555555',
  speechRequests: 1,
};
const second = {
  processIdentifier: 12,
  processInstance: '21111111-2222-4333-8444-555555555555',
  speechRequests: 0,
};
function fixture(change = {}) {
  const saved = {
    nativeObservation: first,
    providerCalls: 1,
    source: { id: 'source' },
    ...change.saved,
  };
  const restored = { nativeObservation: second, sourceId: 'source', ...change.restored };
  const calls = [];
  return {
    calls,
    saved,
    restored,
    run(identifier, baseline) {
      calls.push({ identifier, baseline });
      if (change.failAt === calls.length) throw new Error('preserved first failure');
      return calls.length === 1 ? saved : restored;
    },
  };
}

test('passes the observed UI result to one new-process readback, without a reset or repeated recognition', async () => {
  const value = fixture();
  assert.deepEqual(await executeSpeechJourneyPhases(value.run), [value.saved, value.restored]);
  assert.deepEqual(value.calls, [
    { identifier: speechJourneyTests[0], baseline: undefined },
    { identifier: speechJourneyTests[1], baseline: value.saved },
  ]);
});

test('rejects the first failure, missing native proof, a reused process, another source or new recognition', async () => {
  for (const change of [
    { failAt: 1 },
    { failAt: 2 },
    { saved: { nativeObservation: null } },
    { saved: { providerCalls: 0 } },
    { restored: { nativeObservation: { ...second, processIdentifier: first.processIdentifier } } },
    { restored: { nativeObservation: { ...second, processInstance: first.processInstance } } },
    { restored: { nativeObservation: { ...second, speechRequests: 1 } } },
    { restored: { sourceId: 'other' } },
  ]) {
    const value = fixture(change);
    await assert.rejects(executeSpeechJourneyPhases(value.run));
    assert.ok(value.calls.length <= 2);
    if (change.failAt === 1 || change.saved) assert.equal(value.calls.length, 1);
  }
});

test('reads only one exact UI attachment from the owned destination', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-speech-attachment-'));
  const name = 'automatic-saved-result';
  const attachment = {
    suggestedHumanReadableName: name + '_example.json',
    exportedFileName: first.processInstance + '.json',
    deviceId: 'owned',
  };
  const entry = {
    testIdentifier: speechJourneyTests[0].split('/').slice(1).join('/') + '()',
    attachments: [attachment],
  };
  try {
    writeFileSync(join(directory, attachment.exportedFileName), JSON.stringify({ saved: true }));
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify([entry]));
    assert.deepEqual(readSpeechJourneyAttachment(directory, speechJourneyTests[0], 'owned', name), {
      saved: true,
    });
    assert.throws(() =>
      readSpeechJourneyAttachment(directory, speechJourneyTests[1], 'owned', name),
    );
    assert.throws(() =>
      readSpeechJourneyAttachment(directory, speechJourneyTests[0], 'foreign', name),
    );
    for (const attachments of [
      [attachment, attachment],
      [{ ...attachment, exportedFileName: '../foreign.json' }],
    ]) {
      writeFileSync(join(directory, 'manifest.json'), JSON.stringify([{ ...entry, attachments }]));
      assert.throws(() =>
        readSpeechJourneyAttachment(directory, speechJourneyTests[0], 'owned', name),
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
