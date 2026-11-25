import { recordingSummaryRaceHarness } from '../testSupport/recordingSummaryRaceHarness';

test('summary snapshot returns only current revision payloads and keeps canonical deletion recovery', async () => {
  const fixture = await recordingSummaryRaceHarness();
  const source = 'synthetic-snapshot-recording';
  const retained = 'synthetic-retained-recording';
  try {
    await fixture.seed(source);
    await fixture.seed(retained);
    let prior = `${source}:segment:0:r1`;
    for (let revision = 2; revision <= 12; revision += 1) {
      const row = await fixture.repository.transcripts.correct(
        prior,
        ('Synthetic revision ' + revision + '. ').repeat(80),
        new Date().toISOString(),
      );
      prior = row.id;
    }
    const historical = await fixture.repository.list('transcript_segment');
    expect(historical).toHaveLength(13);

    const nativeTransaction = fixture.database.transaction.bind(
      fixture.database,
    );
    const latestCounts: number[] = [];
    const transaction = jest
      .spyOn(fixture.database, 'transaction')
      .mockImplementation(operation =>
        nativeTransaction(tx =>
          operation({
            ...tx,
            async execute(query, bindings) {
              const result = await tx.execute(query, bindings);
              if (query.includes('FROM transcript_segments AS retained'))
                latestCounts.push(result.rows.length);
              return result;
            },
          }),
        ),
      );
    try {
      const initial = await fixture.library.listSummaries!();
      expect(initial).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: expect.objectContaining({ id: source }),
            transcriptReviewState: 'needsReview',
          }),
          expect.objectContaining({
            source: expect.objectContaining({ id: retained }),
            transcriptReviewState: 'unreviewed',
          }),
        ]),
      );
      expect(latestCounts).toEqual([2]);
      await expect(fixture.library.deleteRecording(source)).resolves.toEqual({
        audioCleanupPending: false,
      });
      expect(await fixture.library.listSummaries!()).toEqual([
        expect.objectContaining({
          source: expect.objectContaining({ id: retained }),
        }),
      ]);
      expect(latestCounts).toEqual([2, 1]);
      expect(
        await fixture.repository.transcripts.listForRecording(source),
      ).toEqual([]);
      expect(fixture.audioOrder).toEqual([
        'reconcile',
        'stage',
        'commit',
        'reconcile',
      ]);
    } finally {
      transaction.mockRestore();
    }
  } finally {
    await fixture.database.closeAsync?.();
  }
});

test('a malformed current payload keeps the summary unavailable rather than substituting an old revision', async () => {
  const fixture = await recordingSummaryRaceHarness();
  const source = 'synthetic-malformed-recording';
  const timestamp = new Date().toISOString();
  try {
    await fixture.seed(source);
    await fixture.database.execute(
      'INSERT INTO transcript_segments (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      [
        `${source}:segment:0:r2`,
        timestamp,
        timestamp,
        timestamp,
        JSON.stringify({
          transcriptId: `${source}:segment:0`,
          revision: 2,
          recordingSourceId: source,
        }),
      ],
    );
    await expect(fixture.library.listSummaries!()).resolves.toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ id: source }),
        transcriptReviewState: 'unavailable',
      }),
    ]);
  } finally {
    await fixture.database.closeAsync?.();
  }
});
