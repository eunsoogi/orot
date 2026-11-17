import type { EvidenceSearchTool } from '@orot/agent-runtime';
import type { RecordRepository } from '@orot/storage';
import type { VisitQuestionEvidenceCollection } from './evidenceCollection';
import type { VisitQuestionEvidenceMetadata } from './evidence';
import { visitQuestionCitationKey } from './evidence';
import type { HealthContextTopic } from '../../healthEvidence/healthContext/types';
import { isBulkSensorObservation } from '../../aiFeatures/integration/providerObservationProjection';

/** Bulk sensor retrieval uses the existing period-source contract so every
 * contributing row remains covered by generation/deletion and saved-source checks. */
export async function projectVisitSensorEvidence(input: {
  collection: VisitQuestionEvidenceCollection;
  repository: Pick<RecordRepository, 'get'>;
  periodTool?: EvidenceSearchTool;
  metadata: ReadonlyMap<string, VisitQuestionEvidenceMetadata>;
  signal?: AbortSignal;
}): Promise<VisitQuestionEvidenceCollection> {
  const sensorKeys = new Set<string>();
  const topics = new Set<HealthContextTopic>();
  for (const item of input.collection.batch.items) {
    const key = visitQuestionCitationKey(item);
    const metadata = input.collection.metadataByCitation.get(key);
    if (
      metadata?.recordKind !== 'health_observation' ||
      !metadata.evidenceRecordId
    )
      continue;
    const record = await input.repository.get(
      'health_observation',
      metadata.evidenceRecordId,
    );
    if (!record) throw new Error('Sensor source is no longer available.');
    if (!isBulkSensorObservation({ kind: 'health_observation', record }))
      continue;
    sensorKeys.add(key);
    const concept = record.concept.toLowerCase();
    if (['step_count', 'workout_duration'].includes(concept))
      topics.add('activity');
    else if (
      ['sleep', 'hkcategorytypeidentifiersleepanalysis'].includes(concept)
    )
      topics.add('sleep');
    // The quantity reader covers arbitrary typed measurement concepts, not only UI-known vital signs.
    else topics.add('measurements');
  }
  if (!sensorKeys.size) return input.collection;
  if (!input.periodTool)
    throw new Error(
      'Period aggregation is unavailable; raw series are not provider evidence.',
    );
  const signal = input.signal ?? new AbortController().signal;
  const period = await input.periodTool.search({
    operationRunId: 'visit-sensor-period',
    operationKey: 'period-read',
    input: { topics: [...topics], detail: 'summary' },
    allowedScope: { sourceKinds: ['personal_record'] },
    resultLimit: topics.size,
    maxPayloadBytes: 65536,
    executionLimits: 'unbounded',
    signal,
  });
  if ('status' in period || !period.items.length || signal.aborted)
    throw new Error('Sensor period evidence could not be prepared.');
  const items = [
    ...input.collection.batch.items.filter(
      item => !sensorKeys.has(visitQuestionCitationKey(item)),
    ),
    ...period.items,
  ];
  const metadataByCitation = new Map(input.collection.metadataByCitation);
  for (const item of period.items) {
    const key = visitQuestionCitationKey(item);
    const metadata = input.metadata.get(key);
    if (!metadata?.healthContextSource)
      throw new Error('Sensor period provenance is unavailable.');
    metadataByCitation.set(key, metadata);
  }
  return {
    ...input.collection,
    metadataByCitation,
    batch: {
      ...input.collection.batch,
      items,
      coverage: [
        ...input.collection.batch.coverage.map(coverage => ({
          ...coverage,
          returnedCount: items.filter(
            item => item.sourceKind === coverage.sourceKind,
          ).length,
        })),
        ...period.coverage,
      ],
    },
  };
}
