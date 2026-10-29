import {
  completeSynchronousSqlWork,
  recordingSummaryRaceHarness,
  resultGate,
} from '../testSupport/recordingSummaryRaceHarness';
import { saveRecordingSource } from '../recordingPersistence';

test('a recording save waits for the read transaction and commits independently of its rollback', async () => {
  const h = await recordingSummaryRaceHarness();
  const gate = resultGate();
  const failure = new Error('read transaction rollback');
  const reading = h.repository
    .transaction(async writer => {
      await writer.list('source_record');
      await gate.wait();
      throw failure;
    })
    .catch(error => error);
  await gate.entered;
  let saveSettled = false;
  const saving = saveRecordingSource(
    {
      id: 'raw-save-during-read',
      durationMs: 2000,
      startedAt: '2026-10-29T00:00:00.000Z',
      completedAt: '2026-10-29T00:00:02.000Z',
      fileProtection: 'complete',
      excludedFromBackup: false,
    },
    async () => h.repository,
  ).then(saved => {
    saveSettled = true;
    return saved;
  });
  try {
    await completeSynchronousSqlWork();
    expect(saveSettled).toBe(false);
    gate.release();
    expect(await reading).toBe(failure);
    const saved = await saving;
    expect(saved.id).toBe('raw-save-during-read');
    expect(await h.repository.get('source_record', saved.id)).not.toBeNull();
  } finally {
    gate.release();
    await Promise.allSettled([reading, saving]);
    await h.database.closeAsync?.();
  }
});

test.each(['append', 'correction'] as const)(
  '%s waits for the real read transaction, whose snapshot remains earlier than that write',
  async writeKind => {
    const h = await recordingSummaryRaceHarness();
    const id = `transaction-${writeKind}`;
    await h.seed(id, writeKind === 'correction');
    const gate = resultGate();
    const reading = h.repository.transaction(async writer => {
      const snapshot = await writer.list('transcript_segment');
      await gate.wait();
      return snapshot;
    });
    await gate.entered;
    let writeSettled = false;
    const writing = (
      writeKind === 'append'
        ? h.appendTranscript(id)
        : h.repository.transcripts.correct(
            `${id}:segment:0:r1`,
            'Synthetic correction',
            '2026-10-29T01:00:00.000Z',
          )
    ).then(() => {
      writeSettled = true;
    });
    try {
      await completeSynchronousSqlWork();
      expect(writeSettled).toBe(false);
      gate.release();
      const snapshot = await reading;
      await writing;
      expect(snapshot.map(row => row.revision)).toEqual(
        writeKind === 'append' ? [] : [1],
      );
      const latest = await h.repository.transcripts.listForRecording(id);
      expect(Math.max(...latest.map(row => row.revision))).toBe(
        writeKind === 'append' ? 1 : 2,
      );
    } finally {
      gate.release();
      await Promise.allSettled([reading, writing]);
      await h.database.closeAsync?.();
    }
  },
);
