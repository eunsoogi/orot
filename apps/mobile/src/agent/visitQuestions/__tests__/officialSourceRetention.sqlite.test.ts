import {
  createRecordRepository,
  createVisitQuestionRecordRepository,
  readVisitQuestionRevision,
} from '@orot/storage';
import { visitHealthFixture } from '../testing/healthContextFixture';
import { setupVisitQuestionGeneratedSourceGuards } from '../../../storage/visitQuestionGeneratedSources';
import {
  mkdtempSync,
  rmSync,
  tmpdir,
  join,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { setupAutomatic } from '../../../../../../packages/storage/__tests__/visitQuestionAutomaticSupport';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { setupVisitQuestionPeriods } from '../../../storage/visitQuestionPeriods';

test.each(['period', 'generated'] as const)(
  'retains original %s evidence when a prepared question changes',
  async source => {
    const directory = mkdtempSync(join(tmpdir(), 'official-sources-'));
    const path = join(directory, 'database.sqlite');
    const f = await visitHealthFixture('measurements', path);
    let closed = false;
    try {
      await f.database.execute(
        'CREATE TABLE symptom_summary_runs (id TEXT PRIMARY KEY, created_at TEXT, model_name TEXT, result_json TEXT)',
      );
      await f.database.transaction(setupVisitQuestionGeneratedSourceGuards);
      await f.database.execute(
        "INSERT INTO symptom_summary_runs VALUES ('summary', 'time', 'model', '{}')",
      );
      await f.save();
      const original = (await f.records.list('visit_question'))[0]!;
      const question = {
        ...original,
        generatedArtifactSources: [
          {
            kind: 'generated_summary' as const,
            type: 'symptom_summary' as const,
            id: 'summary',
            revision: 'r1',
          },
        ],
      };
      await f.records.put('visit_question', question);
      const revision = await readVisitQuestionRevision(f.database, question.id);
      const official = createVisitQuestionRecordRepository(f.database);
      const saved = await official.saveManual({
        appointmentId: question.appointmentId!,
        questionId: question.id,
        expectedQuestionRevision: revision!,
        answer: 'answer',
      });
      await f.records.put('visit_question', {
        ...question,
        questionText: 'changed',
        healthContextSources: undefined,
        generatedArtifactSources: undefined,
      });
      f.close();
      closed = true;
      const reopened = openSqliteTestDatabase(path);
      try {
        const restored = createVisitQuestionRecordRepository(reopened.database);
        const records = createRecordRepository(reopened.database);
        expect(
          (await restored.history(saved.id))[0]?.questionSources?.[0],
        ).toMatchObject({
          healthContextSources: question.healthContextSources,
          generatedArtifactSources: question.generatedArtifactSources,
        });
        await records.delete('health_observation', 'unrelated');
        expect(
          await restored.listForAppointment(question.appointmentId!),
        ).toHaveLength(1);
        if (source === 'period')
          await records.delete('health_observation', f.observation.id);
        else
          await reopened.database.execute(
            "DELETE FROM symptom_summary_runs WHERE id = 'summary'",
          );
        expect(
          await restored.listForAppointment(question.appointmentId!),
        ).toHaveLength(0);
        expect(await restored.history(saved.id)).toHaveLength(0);
      } finally {
        reopened.close();
      }
    } finally {
      if (!closed) f.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test.each(['period', 'generated'] as const)(
  'automatic records retain original %s evidence after amendment',
  async source => {
    const directory = mkdtempSync(join(tmpdir(), 'automatic-sources-'));
    const path = join(directory, 'database.sqlite');
    const f = await setupAutomatic(path);
    let closed = false;
    try {
      await f.database.execute(
        'CREATE TABLE symptom_summary_runs (id TEXT PRIMARY KEY, created_at TEXT, model_name TEXT, result_json TEXT)',
      );
      await f.database.transaction(setupVisitQuestionGeneratedSourceGuards);
      await f.database.transaction(setupVisitQuestionPeriods);
      await f.database.execute(
        "INSERT INTO symptom_summary_runs VALUES ('summary', 'time', 'model', '{}')",
      );
      await f.records.put(
        'health_observation',
        healthObservation('sample', 'heart_rate', '2026-10-01T01:00:00Z'),
      );
      const original = (await f.records.list('visit_question'))[0]!;
      const question = {
        ...original,
        generatedArtifactSources: [
          {
            kind: 'generated_summary' as const,
            type: 'symptom_summary' as const,
            id: 'summary',
            revision: 'r1',
          },
        ],
        healthContextSources: [
          {
            scope: {
              kind: 'health_context_period' as const,
              version: 1 as const,
              topic: 'measurements' as const,
              window: {
                fromInclusive: '2026-10-01T00:00:00Z',
                toExclusive: '2026-10-05T00:00:00Z',
                timeZone: 'UTC',
              },
            },
            revision: 'r1',
            deletionGeneration: 0,
          },
        ],
      };
      await f.records.put('visit_question', question);
      const revision = (await readVisitQuestionRevision(
        f.database,
        question.id,
      ))!;
      const result = {
        ...f.result,
        preparedQuestions: f.result.preparedQuestions.map(item => ({
          ...item,
          revision,
        })),
      };
      const [saved] = await f.official.saveAutomatic(result, {
        loadCurrentInput: f.loadCurrentInput,
      });
      await f.records.put('visit_question', {
        ...question,
        questionText: 'changed',
        generatedArtifactSources: undefined,
        healthContextSources: undefined,
      });
      f.close();
      closed = true;
      const reopened = openSqliteTestDatabase(path);
      try {
        const restored = createVisitQuestionRecordRepository(reopened.database);
        const records = createRecordRepository(reopened.database);
        expect(
          (await restored.history(saved!.id))[0]?.questionSources?.[0]
            ?.generatedArtifactSources,
        ).toEqual(question.generatedArtifactSources);
        if (source === 'period')
          await records.delete('health_observation', 'sample');
        else
          await reopened.database.execute(
            "DELETE FROM symptom_summary_runs WHERE id = 'summary'",
          );
        expect(await restored.history(saved!.id)).toHaveLength(0);
      } finally {
        reopened.close();
      }
    } finally {
      if (!closed) f.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
