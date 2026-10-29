import { recordingSummaryRaceHarness } from '../testSupport/recordingSummaryRaceHarness';

test('a real metadata SELECT error can commit its read transaction and retain an unavailable audio row', async () => {
  const h = await recordingSummaryRaceHarness();
  await h.seed('metadata-error-recording');
  const transaction = h.database.transaction.bind(h.database);
  const tx = jest
    .spyOn(h.database, 'transaction')
    .mockImplementation(operation =>
      transaction(executor =>
        operation({
          ...executor,
          execute: (sql, parameters) =>
            sql.includes('FROM transcript_segments') && sql.startsWith('SELECT')
              ? executor.execute('SELECT * FROM missing_summary_metadata')
              : executor.execute(sql, parameters),
        }),
      ),
    );
  try {
    expect((await h.library.listSummaries!())[0]).toMatchObject({
      durationMs: 2000,
      transcriptReviewState: 'unavailable',
    });
    expect(h.audioOrder).toEqual(['reconcile']);
    expect(
      await h.repository.get('source_record', 'metadata-error-recording'),
    ).not.toBeNull();
    await expect(
      h.database.transaction(async executor => {
        await executor.execute('SELECT 1');
      }),
    ).resolves.toBeUndefined();
  } finally {
    tx.mockRestore();
    await h.database.closeAsync?.();
  }
});

test.each(['begin', 'completion'] as const)(
  'read transaction %s failure propagates and does not poison a later read',
  async phase => {
    const h = await recordingSummaryRaceHarness();
    await h.seed('transaction-error-recording');
    const failure = new Error(`read ${phase} failed`);
    const transaction = h.repository.transaction.bind(h.repository);
    const tx = jest
      .spyOn(h.repository, 'transaction')
      .mockImplementationOnce(async operation => {
        if (phase === 'completion') await transaction(operation);
        throw failure;
      });
    try {
      await expect(h.library.listSummaries!()).rejects.toBe(failure);
      expect(h.audioOrder).toEqual([]);
      tx.mockRestore();
      expect((await h.library.listSummaries!())[0].transcriptReviewState).toBe(
        'unreviewed',
      );
    } finally {
      tx.mockRestore();
      await h.database.closeAsync?.();
    }
  },
);

test('transaction completion errors cannot become metadata-unavailable success', async () => {
  const h = await recordingSummaryRaceHarness();
  await h.seed('metadata-and-completion-error');
  const failure = new Error('transaction completion failed');
  const transaction = h.database.transaction.bind(h.database);
  const tx = jest
    .spyOn(h.database, 'transaction')
    .mockImplementationOnce(async operation => {
      await transaction(executor =>
        operation({
          ...executor,
          execute: (sql, parameters) =>
            sql.includes('FROM transcript_segments') && sql.startsWith('SELECT')
              ? executor.execute('SELECT * FROM missing_summary_metadata')
              : executor.execute(sql, parameters),
        }),
      );
      throw failure;
    });
  try {
    await expect(h.library.listSummaries!()).rejects.toBe(failure);
    expect(h.audioOrder).toEqual([]);
  } finally {
    tx.mockRestore();
    await h.database.closeAsync?.();
  }
});

test('fresh-source and reconciliation errors propagate, retain the source and allow another queue operation', async () => {
  const h = await recordingSummaryRaceHarness();
  await h.seed('source-read-error');
  const failure = new Error('fresh source read failed');
  const read = jest.spyOn(h.repository, 'list').mockRejectedValueOnce(failure);
  try {
    await expect(h.library.listSummaries!()).rejects.toBe(failure);
    read.mockRestore();
    h.failures.reconcile = new Error('reconciliation failed');
    await expect(h.library.listSummaries!()).rejects.toBe(h.failures.reconcile);
    h.failures.reconcile = null;
    expect(await h.library.list()).toHaveLength(1);
  } finally {
    read.mockRestore();
    await h.database.closeAsync?.();
  }
});

test('committed cleanup failure keeps the source deleted and later reconciliation cannot revive it', async () => {
  const h = await recordingSummaryRaceHarness();
  const source = await h.seed('cleanup-pending-recording');
  try {
    h.failures.commit = new Error('audio unlink failed');
    await expect(h.library.deleteRecording(source.id)).resolves.toEqual({
      audioCleanupPending: true,
    });
    h.failures.reconcile = new Error('reconciliation failed');
    await expect(h.library.listSummaries!()).rejects.toBe(h.failures.reconcile);
    expect(await h.repository.get('source_record', source.id)).toBeNull();
    h.failures.reconcile = null;
    expect(await h.library.listSummaries!()).toEqual([]);
    // Source identity fences make membership in an earlier snapshot unambiguous.
    await expect(h.repository.put('source_record', source)).rejects.toThrow(
      /deleted source/,
    );
    await expect(h.appendTranscript(source.id)).rejects.toThrow();
  } finally {
    await h.database.closeAsync?.();
  }
});
