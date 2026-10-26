import { createAgentMemory } from '@orot/agent-memory';
import { createRecordRepository, runMigrations } from '@orot/storage';
import type { HealthContextTopic } from '../../../healthEvidence/healthContext/types';
import { createHealthContextReader } from '../../../healthEvidence/healthContext/reader';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  healthObservation,
  medicationDefinition,
  importedDoseEvent,
} from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { LocalEvidenceReferenceRegistry } from '../../../aiFeatures/integration/evidenceRegistry';
import { registerHealthContextEvidence } from '../../../aiFeatures/integration/healthContextEvidence';
import { setupVisitQuestionPeriods } from '../../../storage/visitQuestionPeriods';
import { SqlCipherAgentMemoryStorage } from '../../../storage/agentMemoryStorage';
import { prepareVisitQuestionContext } from '../evidenceService';
import { saveReviewedVisitQuestions } from '../persistence';
import { appointment, now } from './persistenceFixtures';
import type { SaveReviewedVisitQuestionsInput } from '../persistence';

export const periodWindow = {
  fromInclusive: '2026-10-01T00:00:00Z',
  toExclusive: '2026-10-05T00:00:00Z',
  timeZone: 'UTC',
};

/** Real SQLite and aggregation with synthetic data; only calendar, vector search and embeddings are ports. */
export async function visitHealthFixture(
  topic: HealthContextTopic = 'measurements',
  path = ':memory:',
) {
  const opened = openSqliteTestDatabase(path);
  const database = opened.database;
  await runMigrations(database);
  await database.transaction(setupVisitQuestionPeriods);
  const records = createRecordRepository(database);
  await records.put('appointment', appointment);
  const observation = healthObservation(
    'period-observation',
    topic === 'activity'
      ? 'step_count'
      : topic === 'sleep'
        ? 'sleep'
        : 'heart_rate',
    '2026-10-01T01:00:00Z',
  );
  if (topic === 'medications') {
    await records.put(
      'medication_definition',
      medicationDefinition('medication-1', '2026-09-01T00:00:00Z'),
    );
    await records.put(
      'dose_event',
      importedDoseEvent('period-dose', '2026-10-01T01:00:00Z', 'taken'),
    );
  } else if (topic === 'symptoms') {
    const { id, effectiveAt, ingestedAt, provenance, reviewState } =
      observation;
    await records.put('symptom_entry', {
      status: 'active',
      id,
      effectiveAt,
      ingestedAt,
      provenance,
      reviewState,
      recordedAt: effectiveAt,
      description: '합성 증상',
      severity: 3,
    });
  } else {
    await records.put(
      'health_observation',
      topic === 'sleep'
        ? {
            ...observation,
            endedAt: '2026-10-01T02:00:00Z',
            value: { kind: 'text', text: '3' },
          }
        : observation,
    );
  }
  const read = createHealthContextReader(database);
  const sourceReader = new LocalEvidenceReferenceRegistry();
  const report = await read(periodWindow, [topic]);
  const alias = registerHealthContextEvidence({
    registry: sourceReader,
    read,
    report,
    scope: {
      kind: 'health_context_period',
      version: 1,
      topic,
      window: periodWindow,
    },
  });
  const original = sourceReader.resolve(alias)!;
  const buildChunks = jest.fn(async () => []);
  const prepared = await prepareVisitQuestionContext({
    now,
    maxEvidenceItems: 9,
    repository: records,
    queryService: {
      queryNextConfirmedCalendarAppointment: async () => ({
        status: 'available',
        appointment,
      }),
      searchMemory: async () => ({ status: 'available', hits: [], limit: 3 }),
    },
    rag: { index: jest.fn(), search: jest.fn(async () => []) },
    buildChunks,
    readHealthContext: read,
    currentTime: () => now,
  });
  if (prepared.status !== 'ready')
    throw new Error('Synthetic appointment was not prepared.');
  const item = await prepared.reloadPersonalEvidence(original);
  if (!item) throw new Error('Synthetic health period was not captured.');
  const question = {
    questionText:
      '이 기간에 관찰된 기록의 변화를 다음 진료에서 어떻게 확인할까요?',
    rationale: '기간별 건강 기록을 함께 살펴볼 수 있어요.',
    priority: 'routine' as const,
    citations: [item],
  };
  const save = (overrides: Partial<SaveReviewedVisitQuestionsInput> = {}) =>
    saveReviewedVisitQuestions({
      appointmentId: appointment.id,
      expectedAppointmentRevision: prepared.appointmentRevision,
      now,
      repository: records,
      evidence: prepared.evidence,
      questions: [question],
      revalidateEvidence: prepared.revalidateEvidence,
      ...overrides,
    });
  const memory = () =>
    createAgentMemory({
      embedder: {
        embed: async (texts: string[]) =>
          texts.map(() => Float32Array.from([1, 0, 0])),
      },
      storage: new SqlCipherAgentMemoryStorage(database),
    });
  return {
    ...opened,
    records,
    read,
    item,
    question,
    prepared,
    save,
    memory,
    report,
    observation,
    buildChunks,
  };
}
