import { quarantinedHistoryFixture } from '../../aiFeatures/integration/testSupport/quarantinedHistoryFixture';
import { createGeneratedReportReader } from '../readers';

test('existing source-backed summary restores through strict service; quarantine and deletion never return old prose', async () => {
  const f = await quarantinedHistoryFixture();
  try {
    const data = await f.input.loadLocalData();
    const reader = createGeneratedReportReader(f.database, {
      data: async () => data,
      records: async () => f.repository,
    });
    const rows = await reader.list();
    expect(rows.some(r => r.origin === 'conversation')).toBe(false);
    const row = rows.find(r => r.id === f.saved.id)!;
    expect(row.kind).toBe('health_summary');
    expect(
      (await reader.read(row, new AbortController().signal))?.analysis
        ?.presentation,
    ).toBe('symptom_summary');
    await f.quarantine();
    expect(await reader.read(row, new AbortController().signal)).toBeNull();
    expect((await reader.list()).find(r => r.id === row.id)?.unavailable).toBe(
      true,
    );
    await f.repository.delete('health_observation', f.inside.id);
    expect(await reader.read(row, new AbortController().signal)).toBeNull();
  } finally {
    f.close();
  }
});

test('only explicit completed possibilities are catalogued, linked summaries deduplicate and hidden sessions stay hidden', async () => {
  const f = await quarantinedHistoryFixture();
  try {
    const template = (await f.storage.read('newer'))!;
    await f.storage.append({
      ...template,
      id: 'possibilities',
      entryIntent: 'possibilities',
    });
    await f.storage.append({
      ...template,
      id: 'linked',
      entryIntent: 'possibilities',
      healthSummary: { summaryId: f.saved.id, window: f.report.window },
    });
    const reader = createGeneratedReportReader(f.database, {
      data: f.input.loadLocalData,
      records: async () => f.repository,
    });
    const rows = await reader.list();
    expect(
      rows.filter(r => r.origin === 'conversation').map(r => r.id),
    ).toEqual(['possibilities']);
    expect(
      (
        await reader.read(
          rows.find(r => r.id === 'possibilities')!,
          new AbortController().signal,
        )
      )?.paragraphs,
    ).toEqual([template.answer]);
    await f.database.execute(
      "UPDATE conversation_artifact_sessions SET hidden=1 WHERE id='session'",
    );
    expect((await reader.list()).some(r => r.origin === 'conversation')).toBe(
      false,
    );
  } finally {
    f.close();
  }
});
