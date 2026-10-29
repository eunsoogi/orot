import {
  completeSynchronousSqlWork,
  holdMetadataResult,
  recordingSummaryRaceHarness,
  resultGate,
} from '../testSupport/recordingSummaryRaceHarness';

test('deletion commits before a completed metadata read releases its result and the final list cannot revive it', async () => {
  const h = await recordingSummaryRaceHarness();
  await h.seed('metadata-held-recording');
  const gate = holdMetadataResult(h.repository);
  const listing = h.library.listSummaries!();
  await gate.entered;
  // The gate is after SQL/transaction completion: another real transaction can already run.
  expect(
    await h.repository.transaction(writer =>
      writer.get('source_record', 'metadata-held-recording'),
    ),
  ).not.toBeNull();
  let deletionSettled = false;
  const deletion = h.library
    .deleteRecording('metadata-held-recording')
    .then(result => {
      deletionSettled = true;
      return result;
    });
  try {
    // This SQLite adapter executes synchronously; drain its finite microtask chain, not elapsed time.
    await completeSynchronousSqlWork();
    const committedWhileMetadataHeld = deletionSettled;
    gate.release();
    await deletion;
    const rows = await listing;
    expect(committedWhileMetadataHeld).toBe(true);
    expect(rows).toEqual([]);
    expect(
      await h.repository.get('source_record', 'metadata-held-recording'),
    ).toBeNull();
  } finally {
    gate.release();
    await Promise.allSettled([listing, deletion]);
    gate.restore();
    await h.database.closeAsync?.();
  }
});

test('a source created after the metadata snapshot is visible but its absent metadata is unavailable', async () => {
  const h = await recordingSummaryRaceHarness();
  await h.seed('existing-recording');
  const gate = holdMetadataResult(h.repository);
  const listing = h.library.listSummaries!();
  try {
    await gate.entered;
    await h.seed('new-recording');
    gate.release();
    const rows = await listing;
    expect(rows.find(row => row.source.id === 'new-recording')).toMatchObject({
      durationMs: 2000,
      transcriptReviewState: 'unavailable',
    });
    expect(
      rows.find(row => row.source.id === 'existing-recording'),
    ).toMatchObject({
      transcriptReviewState: 'unreviewed',
    });
  } finally {
    gate.release();
    await Promise.allSettled([listing]);
    gate.restore();
    await h.database.closeAsync?.();
  }
});

test('raw metadata can observe an uncommitted cascade, while the queued summary preserves rollback state', async () => {
  const h = await recordingSummaryRaceHarness();
  await h.seed('rollback-recording');
  const gate = resultGate();
  const failure = new Error('rollback after the source cascade');
  const transaction = h.database.transaction.bind(h.database);
  const tx = jest
    .spyOn(h.database, 'transaction')
    .mockImplementation(operation =>
      transaction(async executor => {
        await operation({
          ...executor,
          execute: async (sql, parameters) => {
            const result = await executor.execute(sql, parameters);
            if (sql.startsWith('DELETE FROM source_records')) {
              await gate.wait();
              throw failure;
            }
            return result;
          },
        });
      }),
    );
  const deletion = h.library
    .deleteRecording('rollback-recording')
    .catch(error => error);
  await gate.entered;
  const listing = h.library.listSummaries!();
  try {
    // A naive queue-external raw query sees removal that will be rolled back.
    expect(await h.repository.list('transcript_segment')).toEqual([]);
    gate.release();
    expect(await deletion).toBe(failure);
    expect((await listing)[0]).toMatchObject({
      transcriptReviewState: 'unreviewed',
    });
    expect(h.audioOrder).toEqual(['stage', 'restore', 'reconcile']);
    expect(
      await h.repository.transcripts.listForRecording('rollback-recording'),
    ).toHaveLength(1);
  } finally {
    gate.release();
    await Promise.allSettled([listing, deletion]);
    tx.mockRestore();
    await h.database.closeAsync?.();
  }
});

test('a late transcript append is reflected by the next snapshot rather than an already completed metadata read', async () => {
  const h = await recordingSummaryRaceHarness();
  await h.seed('later-transcript', false);
  const gate = holdMetadataResult(h.repository);
  const listing = h.library.listSummaries!();
  try {
    await gate.entered;
    await h.appendTranscript('later-transcript');
    gate.release();
    expect((await listing)[0].transcriptReviewState).toBe('notTranscribed');
    expect((await h.library.listSummaries!())[0].transcriptReviewState).toBe(
      'unreviewed',
    );
  } finally {
    gate.release();
    await Promise.allSettled([listing]);
    gate.restore();
    await h.database.closeAsync?.();
  }
});

test('deletion waits for an active read transaction, then finishes without reversing the database and audio locks', async () => {
  const h = await recordingSummaryRaceHarness();
  await h.seed('active-read');
  const gate = resultGate();
  const transaction = h.database.transaction.bind(h.database);
  const tx = jest
    .spyOn(h.database, 'transaction')
    .mockImplementationOnce(operation =>
      transaction(async executor => {
        const result = await operation(executor);
        await gate.wait();
        return result;
      }),
    );
  const listing = h.library.listSummaries!();
  await gate.entered;
  let settled = false;
  const deletion = h.library.deleteRecording('active-read').then(result => {
    settled = true;
    return result;
  });
  try {
    await completeSynchronousSqlWork();
    expect(settled).toBe(false);
    expect(h.audioOrder).toEqual(['stage']);
    gate.release();
    await deletion;
    expect(await listing).toEqual([]);
    expect(h.audioOrder).toEqual(['stage', 'commit', 'reconcile']);
  } finally {
    gate.release();
    await Promise.allSettled([listing, deletion]);
    tx.mockRestore();
    await h.database.closeAsync?.();
  }
});
