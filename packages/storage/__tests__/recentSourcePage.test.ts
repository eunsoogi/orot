import { rewindBeforeMemoryMetadata } from './historicalMigrationSupport';
import { createRecordRepository, listRecentSourcePage, runMigrations } from '../src';
import { openSqliteTestDatabase } from './sqliteTestDatabase';

const when = '2026-11-22T12:00:00.000Z';
const metadata = {
  ingestedAt: when,
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
};

test('recent source cursors seek a partial metadata index, retain offsets and deny removed IDs', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const records = createRecordRepository(f.database);
    for (let i = 0; i < 24; i++) {
      await records.put('source_record', {
        ...metadata,
        id: 'recording-' + String(i).padStart(2, '0'),
        sourceKind: 'audio_recording',
        effectiveAt: when,
        recordedAt: '2026-11-22T21:00:00.000+09:00',
        recordingDurationMs: 900,
        externalReference: 'unknown secret raw locator',
      });
    }
    await records.put('source_record', {
      ...metadata,
      id: 'medical-photo',
      sourceKind: 'medical_document',
      title: 'Imported photo',
      ingestedAt: '2026-11-22T12:00:00.001Z',
    });
    await records.put('source_record', {
      ...metadata,
      id: 'medical-file',
      sourceKind: 'medical_document',
      title: 'Imported file',
      ingestedAt: '2026-11-22T11:59:59.999Z',
    });
    await records.put('source_record', {
      ...metadata,
      id: 'note-not-in-feed',
      sourceKind: 'user_note',
      effectiveAt: when,
      recordedAt: when,
    });
    const before = await f.database.execute(
      'SELECT id,payload_json FROM source_records ORDER BY id',
    );
    await f.database.execute('PRAGMA query_only = ON');
    const execute = jest.fn(f.database.execute);
    const first = await listRecentSourcePage({ execute });
    expect(first).toHaveLength(20);
    expect(first[0]).toMatchObject({ id: 'medical-photo', title: 'Imported photo' });
    const cursor = first.at(-1)!;
    const second = await listRecentSourcePage({ execute }, cursor);
    expect(second).toHaveLength(6);
    expect(second.at(-1)).toMatchObject({ id: 'medical-file', title: 'Imported file' });
    const all = [...first, ...second];
    expect(new Set(all.map((row) => row.id)).size).toBe(26);
    expect(all.map((row) => row.id)).not.toContain('note-not-in-feed');
    expect(JSON.stringify(all)).not.toContain('raw locator');
    for (const [sql, bindings] of execute.mock.calls) {
      expect(sql).not.toMatch(/SELECT .*payload_json\s+(?:FROM|AS (?!kind|title))/i);
      expect(sql).not.toMatch(/evidence_spans|transcript_segments|INSERT|UPDATE|DELETE FROM/i);
      const plan = await f.database.execute('EXPLAIN QUERY PLAN ' + sql, bindings);
      expect(JSON.stringify(plan.rows)).toContain('USING INDEX source_records_recent_page_idx');
      if (bindings?.length) expect(JSON.stringify(plan.rows)).toContain('SEARCH source_records');
    }
    expect(
      await f.database.execute('SELECT id,payload_json FROM source_records ORDER BY id'),
    ).toEqual(before);

    await f.database.execute('PRAGMA query_only = OFF');
    await expect(records.sourceRecords.delete('medical-photo')).resolves.toBe(true);
    await expect(records.sourceRecords.delete('recording-00')).resolves.toBe(true);
    const surviving = await listRecentSourcePage(f.database);
    expect(surviving[0]?.id).toBe('recording-23');
    const final = await listRecentSourcePage(f.database, surviving.at(-1));
    expect(final.map((row) => row.id)).not.toContain('recording-00');
    expect(final.at(-1)?.id).toBe('medical-file');
    expect(
      (
        await f.database.execute(
          'SELECT source_id FROM source_deletion_tombstones ORDER BY source_id',
        )
      ).rows,
    ).toEqual([{ source_id: 'medical-photo' }, { source_id: 'recording-00' }]);
  } finally {
    f.close();
  }
});

test('version 17 upgrade only installs the recent seek index and preserves existing sources', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const records = createRecordRepository(f.database);
    const original = {
      ...metadata,
      id: 'old-import',
      sourceKind: 'medical_document' as const,
      title: 'Retained synthetic original',
      externalReference: 'protected synthetic file identity',
    };
    await records.put('source_record', original);
    // V18 adds only this index; remove it to reproduce the prior V17 schema exactly.
    await f.database.execute('DROP INDEX source_records_recent_page_idx');
    await rewindBeforeMemoryMetadata(f.database, 17);
    await runMigrations(f.database);
    expect((await f.database.execute('PRAGMA user_version')).rows).toEqual([{ user_version: 20 }]);
    expect(await records.sourceRecords.get(original.id)).toEqual(original);
    await expect(listRecentSourcePage(f.database)).resolves.toEqual([
      {
        id: original.id,
        kind: 'medical_document',
        createdAt: original.ingestedAt,
        title: original.title,
      },
    ]);
  } finally {
    f.close();
  }
});

test.each([
  {
    placement: 'first page',
    malformedTimes: ['2026-11-22T13:00:00', '2026-11-22T13:00Z', '2026-11-22T24:00:00Z'],
  },
  {
    placement: 'next page',
    malformedTimes: [
      '2026-11-22T12:00:00',
      '2026-11-22T11:59:00z',
      '2026-11-22T11:58:00.00 Z',
      '2026-02-29T12:00:00Z',
    ],
  },
])(
  'skips unqualified and invalid legacy times before the $placement limit',
  async ({ placement, malformedTimes }) => {
    const f = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(f.database);
      const records = createRecordRepository(f.database);
      const validIds = Array.from(
        { length: 24 },
        (_, i) => 'recording-' + String(i).padStart(2, '0'),
      );
      for (const id of validIds) {
        await records.put('source_record', {
          ...metadata,
          id,
          sourceKind: 'audio_recording',
          effectiveAt: when,
          recordedAt: '2026-11-22T21:00:00.000+09:00',
        });
      }
      for (const [i, invalidAt] of malformedTimes.entries()) {
        // Ingest through the normal writer first, then model a malformed legacy inventory timestamp.
        const id = placement === 'first page' ? `legacy-${i}` : `recording-01-legacy-${i}`;
        await records.put('source_record', {
          ...metadata,
          id,
          sourceKind: 'medical_document',
          title: 'Synthetic imported detail',
        });
        await f.database.execute('UPDATE source_records SET ingested_at = ? WHERE id = ?', [
          invalidAt,
          id,
        ]);
      }
      await f.database.execute('PRAGMA query_only = ON');
      const first = await listRecentSourcePage(f.database);
      const newestFirstIds = [...validIds].reverse();
      expect(first.map((row) => row.id)).toEqual(newestFirstIds.slice(0, 20));
      const second = await listRecentSourcePage(f.database, first.at(-1)!);
      expect(second.map((row) => row.id)).toEqual(newestFirstIds.slice(20));
    } finally {
      f.close();
    }
  },
);

test('admits a valid leap day, offset and submillisecond fraction without rewriting the timestamp', async () => {
  const f = openSqliteTestDatabase(':memory:');
  const zoned = '2024-02-29T08:00:00.123456-04:00';
  const utc = '2024-02-29T12:00:00.123457Z';
  try {
    await runMigrations(f.database);
    const records = createRecordRepository(f.database);
    for (const [id, ingestedAt] of [
      ['zoned', zoned],
      ['utc', utc],
    ] as const) {
      await records.put('source_record', {
        ...metadata,
        id,
        sourceKind: 'medical_document',
        ingestedAt,
      });
    }
    const first = await listRecentSourcePage(f.database);
    expect(first.map((row) => [row.id, row.createdAt])).toEqual([
      ['utc', utc],
      ['zoned', zoned],
    ]);
    await expect(listRecentSourcePage(f.database, first[0])).resolves.toEqual([first[1]]);
  } finally {
    f.close();
  }
});

test('surfaces the original store failure instead of replacing it with an empty page', async () => {
  const failure = new Error('Synthetic storage failure');
  const execute = jest.fn().mockRejectedValue(failure);
  await expect(listRecentSourcePage({ execute })).rejects.toBe(failure);
});
