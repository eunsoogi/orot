import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthContextReader } from '../../healthEvidence/healthContext/reader';
import type { HealthContextTopic } from '../../healthEvidence/healthContext/types';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { registerHealthContextEvidence } from '../../aiFeatures/integration/healthContextEvidence';
import { captureSymptomSummarySources } from '../../aiFeatures/integration/symptomSummarySources';
import { captureConversationToolSources } from '../../aiFeatures/integration/captureConversationToolSources';
import { createSymptomSummaryStorage } from '../symptomSummaryStorage';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createResearchArtifactStorage } from '../researchArtifactStorage';
import {
  setupVisitQuestionPeriods,
  appendVisitQuestionPeriod,
} from '../visitQuestionPeriods';
import { isPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';

/** Actual production readers, serializers and stores with synthetic measurements only. */
export async function periodContributorFixture(
  concept: string,
  topic: HealthContextTopic,
  overlap = false,
  duplicate = false,
) {
  const opened = openSqliteTestDatabase(':memory:');
  await runMigrations(opened.database);
  const repository = createRecordRepository(opened.database);
  const window = {
    fromInclusive: '2026-10-01T00:00:00Z',
    toExclusive: '2026-10-05T00:00:00.000Z',
    timeZone: 'UTC',
  };
  const candidate = {
    ...healthObservation(
      'candidate',
      concept,
      overlap ? '2026-09-30T23:00:00Z' : '2026-10-01T01:00:00Z',
      'healthkit',
      'imported',
      overlap ? '2026-10-01T02:00:00Z' : undefined,
    ),
    value: { kind: 'quantity' as const, amount: 72, unit: 'count' },
  };
  await repository.put('health_observation', candidate);
  if (overlap)
    await repository.put(
      'health_observation',
      healthObservation(
        'heart',
        'heart_rate',
        '2026-10-01T01:00:00Z',
        'healthkit',
        'imported',
        '2026-10-01T01:00:00Z',
      ),
    );
  if (duplicate)
    await repository.put('health_observation', {
      ...candidate,
      id: 'duplicate',
    });
  const read = createHealthContextReader(opened.database),
    registry = new LocalEvidenceReferenceRegistry();
  const report = await read(window, [topic]);
  const item = registerHealthContextEvidence({
    registry,
    read,
    report,
    scope: { kind: 'health_context_period', version: 1, topic, window },
  });
  const captured = await captureSymptomSummarySources(
    {
      presentation: 'symptom_summary',
      hypotheses: [
        {
          title: 'Synthetic',
          summary: 'Synthetic period statistic.',
          supportingEvidence: [item],
          contraryEvidence: [],
          missingData: [],
          uncertainty: '',
        },
      ],
    },
    registry,
    new AbortController().signal,
  );
  const saved = {
    ...captured,
    inputLineage: 'complete' as const,
    id: 'saved',
    createdAt: '2026-10-05T00:00:00.000Z',
    modelName: 'Synthetic',
    modelId: 'synthetic',
    providerId: 'synthetic',
  };
  const source = saved.sources.find(isPeriodSummarySource)!;
  const summary = createSymptomSummaryStorage(opened.database);
  await summary.append(saved);
  const conversation = createConversationArtifactStorage(opened.database);
  await conversation.createSession(
    'session',
    await conversation.currentGeneration(),
  );
  await conversation.append({
    id: 'turn',
    sessionId: 'session',
    createdAt: saved.createdAt,
    providerId: 'synthetic',
    modelId: 'synthetic',
    status: 'complete',
    question: 'Synthetic',
    answer: 'Synthetic period statistic.',
    sources: saved.sources,
  });
  const tool = await captureConversationToolSources(
    {
      version: 1,
      operationRunId: 'run',
      callId: 'call',
      toolName: 'health',
      order: 1,
      status: 'completed',
      inputSummary: { sourceKind: item.sourceKind },
      resultSummary: { referenceCount: 1 },
      sources: [item],
    },
    registry,
  );
  await conversation.appendToolEvent({
    sessionId: 'session',
    messageId: 'turn',
    createdAt: saved.createdAt,
    sessionVersion: 0,
    ...tool,
  });
  const research = createResearchArtifactStorage(opened.database);
  await research.append(
    [
      {
        createdAt: saved.createdAt,
        originFeature: 'symptom_summary',
        providerId: 'synthetic',
        modelId: 'synthetic',
        source: {
          kind: 'public_web_search',
          status: 'historical_snapshot',
          retrievedAt: saved.createdAt,
          sources: [{ title: 'Synthetic', url: 'https://example.org' }],
        },
        generatedText: 'Synthetic research',
        inputSources: saved.sources,
      },
    ],
    await research.currentGeneration(),
  );
  await setupVisitQuestionPeriods(opened.database);
  await appendVisitQuestionPeriod(
    opened.database,
    'synthetic-question',
    source,
  );
  return {
    ...opened,
    repository,
    candidate,
    read,
    window,
    report,
    source,
    summary,
    conversation,
    research,
    saved,
  };
}
