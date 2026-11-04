import { createRecordRepository, runMigrations } from '@orot/storage';
import {
  medicationDefinition,
  importedDoseEvent,
} from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { createHealthContextReader } from '../reader';
import { healthContextContent } from '../../../aiFeatures/integration/healthContextEvidence';
import { createHealthContextTool } from '../../../aiFeatures/integration/healthContextTool';
import { LocalEvidenceReferenceRegistry } from '../../../aiFeatures/integration/evidenceRegistry';
import { readDoseHistory } from '../doseHistoryQuery';

test('delivers selected dose events, their times and amounts from SQLite to model evidence', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    await records.put('medication_definition', {
      ...medicationDefinition('medication-1', '2026-09-01T00:00:00Z'),
      displayText: 'Example A',
    });
    await records.put('dose_event', {
      ...importedDoseEvent('taken', '2026-10-01T15:00:00Z', 'taken'),
      ingestedAt: '2026-10-03T00:00:00Z',
      scheduledAt: '2026-10-01T14:30:00Z',
      dose: { amount: 2, unit: 'tablet' },
    });
    await records.put('dose_event', {
      ...importedDoseEvent('skipped', '2026-10-02T01:00:00Z', 'skipped'),
      ingestedAt: '2026-10-03T00:00:00Z',
    });
    const window = {
      fromInclusive: '2026-10-01T15:00:00Z',
      toExclusive: '2026-10-02T15:00:00Z',
      timeZone: 'Asia/Seoul',
      doseHistory: { medicationName: 'Example A', page: 0, pageSize: 1 },
    };
    await records.put('medication_definition', {
      ...medicationDefinition('medication-2', '2026-09-01T00:00:00Z'),
      displayText: 'Example B',
    });
    await records.put('dose_event', {
      ...importedDoseEvent('other', '2026-10-01T16:00:00Z', 'taken'),
      medicationDefinitionId: 'medication-2',
      ingestedAt: '2026-10-03T00:00:00Z',
    });
    await records.put('dose_event', {
      ...importedDoseEvent('before', '2026-10-01T14:59:59Z', 'taken'),
      ingestedAt: '2026-10-03T00:00:00Z',
    });
    await records.put('dose_event', {
      ...importedDoseEvent('end', '2026-10-02T15:00:00Z', 'taken'),
      ingestedAt: '2026-10-03T00:00:00Z',
    });
    const read = createHealthContextReader(database);
    const report = await read(window, ['medications']);
    const scope = {
      kind: 'health_context_period' as const,
      version: 1 as const,
      topic: 'medications' as const,
      window,
    };
    const content = JSON.parse(
      healthContextContent(scope, report).slice('health_context: '.length),
    );
    expect(content.doseHistory).toMatchObject({
      records: [
        {
          medicationName: 'Example A',
          effectiveAt: '2026-10-01T15:00:00Z',
          scheduledAt: '2026-10-01T14:30:00Z',
          observationStatus: 'taken',
          dose: { amount: 2, unit: 'tablet' },
        },
      ],
      hasMore: true,
    });
    const second = await read(
      { ...window, doseHistory: { ...window.doseHistory, page: 1 } },
      ['medications'],
    );
    expect(second.doseHistory).toMatchObject({
      records: [
        { effectiveAt: '2026-10-02T01:00:00Z', observationStatus: 'skipped' },
      ],
      hasMore: false,
    });
    const registry = new LocalEvidenceReferenceRegistry();
    const tool = createHealthContextTool(read, registry, 'rag');
    const input = { window, topics: ['medications'] };
    expect(tool.parseInput(input)).toBeDefined();
    expect(
      createHealthContextTool(read, registry, 'visit').parseInput(input),
    ).toBeUndefined();
    expect(
      createHealthContextTool(read, registry, 'disease').parseInput(input),
    ).toBeUndefined();
    const result = await tool.search({
      input,
      operationRunId: 'dose-test',
      operationKey: 'dose-test',
      allowedScope: { sourceKinds: ['personal_record'] },
      resultLimit: 1,
      maxPayloadBytes: 20480,
      signal: new AbortController().signal,
    });
    if ('status' in result) throw new Error('Expected evidence batch.');
    expect(result.items[0]?.content).toContain('2026-10-01T14:30:00Z');
    expect(result.items[0]?.content).not.toContain('medication-1');
    expect(result.items[0]?.content).not.toContain('Example B');
    expect(
      await registry.revalidateEvidence(
        result.items,
        new AbortController().signal,
      ),
    ).toBe(true);
    await records.delete('dose_event', 'taken');
    expect(
      await registry.revalidateEvidence(
        result.items,
        new AbortController().signal,
      ),
    ).toBe(false);
    await database.execute(
      'INSERT INTO transcript_artifact_staleness (transcript_id, artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        'synthetic-transcript',
        'medication_definition',
        'medication-1',
        'old',
        'new',
        '2026-10-05T00:00:00Z',
      ],
    );
    expect((await readDoseHistory(database, window)).records).toHaveLength(0);
    const unnamed = await readDoseHistory(database, {
      ...window,
      doseHistory: { page: 0, pageSize: 20 },
    });
    expect(
      unnamed.records.find(record => record.observationStatus === 'skipped')
        ?.medicationName,
    ).toBeNull();
  } finally {
    close();
  }
});
