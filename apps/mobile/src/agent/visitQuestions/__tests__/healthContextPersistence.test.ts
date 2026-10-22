import { visitHealthFixture } from '../testing/healthContextFixture';
import { restoreVisitQuestionHealthContext } from '../../../aiFeatures/integration/savedVisitQuestionHealthContext';
import { LocalEvidenceReferenceRegistry } from '../../../aiFeatures/integration/evidenceRegistry';
import { createVisitQuestionSourceService } from '../../../aiFeatures/integration/visitQuestionSourceRegistration';
import { healthContextRevision } from '../../../healthEvidence/healthContext/scope';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createHealthContextReader } from '../../../healthEvidence/healthContext/reader';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { restoreSavedVisitQuestions } from '../../../aiFeatures/integration/savedVisitQuestions';
import { setupVisitQuestionPeriods } from '../../../storage/visitQuestionPeriods';

declare const require: (specifier: string) => unknown;

test('stores a fixed computed source and restores a readable original without raw sample IDs', async () => {
  const f = await visitHealthFixture();
  try {
    expect(f.prepared.evidence.batch.items).toHaveLength(0);
    expect(f.prepared.healthContextTool?.id).toBe('local-health-context');
    expect(f.buildChunks).not.toHaveBeenCalled();
    expect(await f.prepared.revalidateEvidence([f.item])).toBe(true);
    await f.save();
    const row = (await f.records.list('visit_question'))[0]!;
    expect(row.healthContextSources).toHaveLength(1);
    expect(row.evidenceSpanIds).toEqual([]);
    expect(row.provenance.sourceRecordIds).toEqual(['appointment-1']);
    const source = row.healthContextSources![0]!;
    const registry = new LocalEvidenceReferenceRegistry();
    const restored = await restoreVisitQuestionHealthContext(
      JSON.parse(JSON.stringify(source)),
      f.read,
      registry,
    );
    expect(
      await registry.revalidateEvidence(
        [restored],
        new AbortController().signal,
      ),
    ).toBe(true);
    expect(restored.content).toContain('health_context:');
    // The normal source action must read the computed period, not query a synthetic ID as a SourceRecord.
    const raw = registry.resolve(restored)!;
    const querySource = jest.fn();
    const service = createVisitQuestionSourceService(
      registry,
      async () =>
        ({ readHealthContext: f.read, repository: { querySource } }) as never,
    );
    const displayed = service.registerVisitQuestionSource(
      { ...raw, content: restored.content },
      async () => true,
    );
    expect(
      await registry.readSource(displayed, new AbortController().signal),
    ).toMatchObject({
      status: 'available',
      document: { sourceKind: 'health_context_period', scope: source.scope },
    });
    expect(querySource).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

test('rechecks inside the transaction and retains the existing list when health facts change after preflight', async () => {
  const f = await visitHealthFixture();
  try {
    await f.save();
    await expect(
      f.save({
        revalidateEvidence: async () => {
          await f.records.put('health_observation', {
            ...f.observation,
            value: { kind: 'quantity', amount: 81, unit: 'count/min' },
          });
          return true;
        },
      }),
    ).rejects.toThrow('health period changed');
    expect(await f.records.list('visit_question')).toHaveLength(1);
    expect(await f.prepared.revalidateEvidence([f.item])).toBe(false);
    const source = (await f.records.list('visit_question'))[0]!
      .healthContextSources![0]!;
    await expect(
      restoreVisitQuestionHealthContext(
        source,
        f.read,
        new LocalEvidenceReferenceRegistry(),
      ),
    ).rejects.toThrow('health-period');
    expect(
      healthContextRevision(
        source.scope,
        await f.read(source.scope.window, [source.scope.topic]),
      ),
    ).not.toBe(source.revision);
  } finally {
    f.close();
  }
});

test('rolls a failed period dependency insert back together with replacement of an existing list', async () => {
  const f = await visitHealthFixture();
  try {
    await f.save();
    await f.database.execute(
      "CREATE TRIGGER period_insert_failure BEFORE INSERT ON visit_question_periods BEGIN SELECT RAISE(ABORT, 'synthetic dependency failure'); END",
    );
    await expect(f.save()).rejects.toThrow('synthetic dependency failure');
    expect(await f.records.list('visit_question')).toHaveLength(1);
    expect(
      (
        await f.database.execute(
          'SELECT question_id FROM visit_question_periods',
        )
      ).rows,
    ).toHaveLength(1);
  } finally {
    f.close();
  }
});

test('reopens saved period questions with current original sources and keeps deletion guards after restart', async () => {
  const fs = require('node:fs') as {
    mkdtempSync(prefix: string): string;
    rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
  };
  const os = require('node:os') as { tmpdir(): string };
  const path = require('node:path') as { join(...parts: string[]): string };
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'orot-health-period-'),
  );
  let current: { close(): void } | undefined;
  try {
    const file = path.join(directory, 'records.sqlite');
    const f = await visitHealthFixture('measurements', file);
    current = f;
    await f.save();
    f.close();
    current = undefined;
    const reopened = openSqliteTestDatabase(file);
    current = reopened;
    await runMigrations(reopened.database);
    await reopened.database.transaction(setupVisitQuestionPeriods);
    const records = createRecordRepository(reopened.database);
    const registry = new LocalEvidenceReferenceRegistry();
    const restored = await restoreSavedVisitQuestions({
      appointmentId: 'appointment-1',
      records,
      registry,
      sourceReader: createLocalHealthEvidenceRepository(reopened.database),
      readHealthContext: createHealthContextReader(reopened.database),
    });
    expect(restored.questions).toHaveLength(1);
    expect(restored.questions[0]?.questionText).toBe(f.question.questionText);
    const citations = restored.questions[0]!.citations;
    expect(citations).toHaveLength(1);
    expect(
      await registry.revalidateEvidence(
        citations,
        new AbortController().signal,
      ),
    ).toBe(true);
    expect(
      await registry.readSource(citations[0]!, new AbortController().signal),
    ).toMatchObject({
      status: 'available',
      document: { sourceKind: 'health_context_period' },
    });
    await records.delete('health_observation', f.observation.id);
    expect(await records.list('visit_question')).toHaveLength(0);
  } finally {
    current?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
