import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { buildRecentRecordEntries } from '../../routes/RecordsRecentTimeline';
import { listRecentMaterial } from '../catalog';
import { createSymptomSummaryStorage } from '../../storage/symptomSummaryStorage';

test('a zone-less visit cursor keeps SQLite UTC and its exact stored identity', async () => {
  const f = openSqliteTestDatabase(':memory:');
  const localLooking = '2026-11-22T12:00:00.000201';
  const summaryClock = '2026-11-22T12:00:00.000251';
  try {
    await runMigrations(f.database);
    await createSymptomSummaryStorage(f.database).prepareRetentionGuards();
    await f.database.execute(
      'INSERT INTO symptom_summary_runs (id,created_at,model_name,result_json) VALUES (?,?,?,?)',
      [
        'legacy-summary',
        summaryClock,
        'synthetic',
        JSON.stringify({
          id: 'legacy-summary',
          createdAt: summaryClock,
          analysis: { hypotheses: [] },
          modelId: 'synthetic-model',
          providerId: 'synthetic-provider',
          sources: [],
        }),
      ],
    );
    const visits = [
      ...Array.from({ length: 18 }, (_, i) => [
        `new-${i}`,
        `new-${i}`,
        '2026-11-22T15:00:00Z',
      ]),
      ['naive', 'legacy', localLooking],
      ['legacy-neighbor', 'legacy', '2026-11-22T21:00:00.000101+09:00'],
      ['after-cursor', 'earlier', '2026-11-22T08:00:00Z'],
    ];
    for (const [id, appointmentId, timestamp] of visits) {
      await f.database.execute(
        'INSERT INTO visit_questions(id,effective_at,recorded_at,ingested_at,payload_json) VALUES (?,?,?,?,?)',
        [
          id,
          timestamp,
          timestamp,
          timestamp,
          JSON.stringify({ appointmentId }),
        ],
      );
    }
    const first = await listRecentMaterial(f.database);
    expect(first).toHaveLength(20);
    const summary = first.at(-2)!;
    expect(summary).toMatchObject({
      key: 'summary:legacy-summary',
      createdAt: summaryClock,
    });
    expect(
      (await listRecentMaterial(f.database, summary)).map(row => row.key),
    ).toEqual(['visit:legacy', 'visit:earlier']);
    const last = first.at(-1)!;
    // This is still the exact metadata identity returned to the protected destination.
    expect(last).toMatchObject({
      key: 'visit:legacy',
      createdAt: localLooking,
    });
    expect(await listRecentMaterial(f.database, last)).toEqual([
      {
        key: 'visit:earlier',
        id: 'earlier',
        createdAt: '2026-11-22T08:00:00Z',
        origin: 'visit',
        kind: 'visit_questions',
        unavailable: false,
      },
    ]);
    const sorted = buildRecentRecordEntries(
      [],
      [],
      [last],
      [
        {
          id: 'newer-file',
          key: 'newer-file',
          kind: 'medical_document',
          createdAt: '2026-11-22T21:00:00.000301+09:00',
        },
        {
          id: 'older-audio',
          key: 'older-audio',
          kind: 'audio_recording',
          createdAt: '2026-11-22T21:00:00.000101+09:00',
        },
      ],
    );
    expect(sorted.map(row => row.id)).toEqual([
      'newer-file',
      'visit:legacy',
      'older-audio',
    ]);
    expect(sorted[1]?.timestamp).toBe(localLooking + 'Z');
    expect(sorted[1]?.material).toBe(last);
  } finally {
    f.close();
  }
});
