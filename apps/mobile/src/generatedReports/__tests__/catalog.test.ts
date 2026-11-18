import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { listGeneratedReports } from '../catalog';

/** A restored legacy store may precede optional daily/policy schema installation. */
test('legacy summaries remain metadata-only, malformed JSON is not a report, tied dates paginate without loss', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await f.database.execute(
      'CREATE TABLE symptom_summary_runs(id TEXT PRIMARY KEY,created_at TEXT,model_name TEXT,result_json TEXT)',
    );
    const date = '2026-01-01T00:00:00Z';
    for (let i = 0; i < 25; i++) {
      const id = String(i).padStart(3, '0');
      await f.database.execute(
        'INSERT INTO symptom_summary_runs VALUES (?,?,?,?)',
        [
          id,
          date,
          'synthetic',
          JSON.stringify({
            id,
            providerId: 'local',
            modelId: 'synthetic',
            sources: [],
            analysis: {
              hypotheses: [],
              ...(i === 0 ? { presentation: 'symptom_summary' } : {}),
            },
          }),
        ],
      );
    }
    await f.database.execute(
      'INSERT INTO symptom_summary_runs VALUES (?,?,?,?)',
      ['bad', date, 'synthetic', '{"ordinary":"not a report"}'],
    );
    await f.database.execute(
      'INSERT INTO symptom_summary_runs VALUES (?,?,?,?)',
      [
        'broken-date',
        'not a timestamp',
        'synthetic',
        JSON.stringify({
          id: 'broken-date',
          providerId: 'local',
          modelId: 'synthetic',
          sources: [],
          analysis: { hypotheses: [] },
        }),
      ],
    );
    const first = await listGeneratedReports(f.database),
      last = first.at(-1)!;
    const second = await listGeneratedReports(f.database, {
      createdAt: last.createdAt,
      key: last.key,
    });
    expect(first).toHaveLength(20);
    expect(second).toHaveLength(5);
    expect(new Set([...first, ...second].map(r => r.key)).size).toBe(25);
    expect([...first, ...second].every(r => r.unavailable)).toBe(true);
    expect(second.at(-1)?.kind).toBe('health_summary');
    expect(JSON.stringify(first)).not.toContain('hypotheses');
  } finally {
    f.close();
  }
});

test('generated visit questions are grouped by appointment, not recap rows', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await f.database.execute(
      'CREATE TABLE visit_questions(id TEXT,payload_json TEXT,recorded_at TEXT,effective_at TEXT,ingested_at TEXT)',
    );
    for (const id of ['a', 'b'])
      await f.database.execute(
        'INSERT INTO visit_questions VALUES (?,?,?,?,?)',
        [
          id,
          JSON.stringify({
            appointmentId: 'visit',
            questionText: 'PRIVATE question',
          }),
          '2026-01-01T00:00:00Z',
          null,
          null,
        ],
      );
    const rows = await listGeneratedReports(f.database);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'visit', kind: 'visit_questions' });
    expect(JSON.stringify(rows)).not.toContain('PRIVATE');
  } finally {
    f.close();
  }
});
