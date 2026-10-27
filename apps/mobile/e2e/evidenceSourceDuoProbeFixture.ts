import type { EvidenceItem, EvidenceReference } from '@orot/agent-runtime';
import type { EvidenceSpan, SourceRecord } from '@orot/domain';
import { chunkEvidenceSpan } from '@orot/rag';
import type { EvidenceChunk } from '@orot/rag';
import { createRecordRepository, runMigrations } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import type { AiFeatureServiceDependencies } from '../src/aiFeatures/integration/featureServices';
import type { AiFeatureLocalData } from '../src/aiFeatures/integration/localData';
import { fingerprint } from '../src/aiFeatures/integration/evidenceUtils';

const SOURCE_RECORD_ID = 'synthetic-evidence-source-duo-record';
const EVIDENCE_SPAN_ID = 'synthetic-evidence-source-duo-excerpt';
const SOURCE_TEXT = '합성 원문 기록: 측정 결과를 저장할 때 남긴 설명입니다.';
const EFFECTIVE_AT = '2026-10-20T08:00:00.000Z';

export const evidenceSourceDuoFixtureRecords = {
  source: {
    id: SOURCE_RECORD_ID,
    title: '합성 저장 기록',
    sourceKind: 'user_note',
    effectiveAt: EFFECTIVE_AT,
    recordedAt: EFFECTIVE_AT,
    ingestedAt: EFFECTIVE_AT,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  } satisfies SourceRecord,
  excerpt: {
    id: EVIDENCE_SPAN_ID,
    sourceRecordId: SOURCE_RECORD_ID,
    text: SOURCE_TEXT,
    effectiveAt: EFFECTIVE_AT,
    recordedAt: EFFECTIVE_AT,
    ingestedAt: EFFECTIVE_AT,
    provenance: {
      origin: 'imported',
      sourceRecordIds: [SOURCE_RECORD_ID],
    },
    reviewState: { status: 'unreviewed' },
    locator: { kind: 'text_range', startOffset: 0, endOffset: 13 },
  } satisfies EvidenceSpan,
};

const sourceChunk: EvidenceChunk = chunkEvidenceSpan(
  evidenceSourceDuoFixtureRecords.excerpt,
);

/** Seeds only the reserved synthetic source and refuses to replace an unexpected existing row. */
export async function seedEvidenceSourceDuoRecords(
  database: SqlDatabase,
): Promise<void> {
  await runMigrations(database);
  const records = createRecordRepository(database);
  const source = evidenceSourceDuoFixtureRecords.source;
  const savedSource = await records.get('source_record', source.id);
  if (savedSource && fingerprint(savedSource) !== fingerprint(source)) {
    throw new Error('The reserved evidence source fixture ID is already used.');
  }
  if (!savedSource) await records.put('source_record', source);

  const excerpt = evidenceSourceDuoFixtureRecords.excerpt;
  const savedExcerpt = await records.get('evidence_span', excerpt.id);
  if (savedExcerpt && fingerprint(savedExcerpt) !== fingerprint(excerpt)) {
    throw new Error(
      'The reserved evidence excerpt fixture ID is already used.',
    );
  }
  if (!savedExcerpt) await records.put('evidence_span', excerpt);
}

/** Keeps retrieval fixture-controlled while leaving SQLCipher reads, citation registration, and source reading real. */
export function createEvidenceSourceDuoServiceDependencies(
  selectedAi: AiFeatureServiceDependencies['selectedAi'],
): AiFeatureServiceDependencies {
  return {
    selectedAi,
    loadLocalData: loadEvidenceSourceDuoLocalData,
    summaryStorage: async () => ({
      append: async () => undefined,
      list: async () => [],
      read: async () => null,
    }),
    diseaseRunner: runEvidenceSourceDuoDisease,
  };
}

/** Keeps disease and source probes separately opted in while sharing the synthetic provider. */
export function selectAiFeatureProbeDependencies(
  settings: Readonly<Record<string, unknown>>,
  diseaseDependencies: AiFeatureServiceDependencies | undefined,
  sourceProviderDependencies:
    AiFeatureServiceDependencies | undefined = diseaseDependencies,
): AiFeatureServiceDependencies | undefined {
  if (settings.OROT_EVIDENCE_SOURCE_DUO_VISUAL_STATE === 'synthetic') {
    return createEvidenceSourceDuoServiceDependencies(
      sourceProviderDependencies?.selectedAi,
    );
  }
  return settings.OROT_DISEASE_HYPOTHESES_VISUAL_STATE === 'synthetic'
    ? diseaseDependencies
    : undefined;
}

async function loadEvidenceSourceDuoLocalData(): Promise<AiFeatureLocalData> {
  // The opt-in probe uses the app's encrypted database, but seeds before its normal data adapter is cached.
  const [{ openAiFeatureLocalData }, { openLocalAgentMemoryDatabase }] =
    await Promise.all([
      import('../src/aiFeatures/integration/localData'),
      import('../src/storage/secureDatabase'),
    ]);
  const database = await openLocalAgentMemoryDatabase();
  await seedEvidenceSourceDuoRecords(database);
  const data = await openAiFeatureLocalData();

  return {
    ...data,
    loadMemoryRecords: async () => [],
    readManualHistoryCandidates: async () => ({
      candidates: [],
      hasMoreCandidates: false,
    }),
    async readCandidates(query, signal, scope) {
      const selection = await data.readCandidates(query, signal, scope);
      const [excerpt, source] = await Promise.all([
        data.repository.readRecord('evidence_span', EVIDENCE_SPAN_ID, signal),
        data.repository.readRecord('source_record', SOURCE_RECORD_ID, signal),
      ]);
      if (!excerpt || !source) {
        throw new Error('The synthetic evidence source is unavailable.');
      }
      return {
        ...selection,
        candidates: [{ kind: 'evidence_span', record: excerpt }],
        dependencies: [{ kind: 'source_record', record: source }],
        hasMoreCandidates:
          selection.hasMoreCandidates || selection.candidates.length > 0,
      };
    },
    async loadCurrentChunks(identities, signal) {
      if (signal?.aborted)
        throw new Error('The synthetic evidence request was cancelled.');
      return identities.some(
        identity =>
          identity.kind === 'evidence_span' && identity.id === EVIDENCE_SPAN_ID,
      )
        ? [sourceChunk]
        : [];
    },
    rag: {
      // A fixed search order avoids embedding work without changing citation validation or reading.
      index: async () => undefined,
      search: async (_query, chunks, limit) =>
        chunks.slice(0, limit).map((chunk, index) => ({
          chunk,
          score: 1,
          lexicalRank: index + 1,
          vectorRank: index + 1,
        })),
    },
  };
}

const runEvidenceSourceDuoDisease: NonNullable<
  AiFeatureServiceDependencies['diseaseRunner']
> = async (workflow, _inventory, invocation, _resolve, task) => {
  const tool = workflow.tools.find(
    value => value.id === 'local-personal-records',
  );
  if (!tool) throw new Error('The local evidence search tool is unavailable.');
  const result = await tool.search({
    operationRunId: workflow.execution.operationRunId,
    operationKey: 'evidence-source-duo-probe',
    input: { query: '저장된 원문 근거 확인' },
    allowedScope: { sourceKinds: ['personal_record'] },
    resultLimit: 1,
    maxPayloadBytes: 16 * 1024,
    signal: invocation?.signal ?? new AbortController().signal,
  });
  if ('status' in result) {
    throw new Error('The local synthetic evidence search was not available.');
  }
  // Fixture-controlled retrieval returns one saved citation; preserve its opaque registry alias.
  const [item] = result.items;
  if (result.items.length !== 1 || !item) {
    throw new Error('The synthetic evidence citation was not found.');
  }
  const citation = referenceOnly(item);
  return {
    status: 'workflow',
    result: {
      status: 'result',
      value: {
        ...(task ? { presentation: 'symptom_summary' as const } : {}),
        hypotheses: [
          {
            title: '합성 저장 기록',
            summary: '화면 동작 확인을 위한 합성 원문입니다.',
            supportingEvidence: [citation],
            contraryEvidence: [],
            uncertainty: '합성 자료는 실제 건강 상태를 설명하지 않습니다.',
            missingData: [],
          },
        ],
      },
      citations: [citation],
      coverage: [],
      checkpoint: {} as never,
    },
  } as never;
};

function referenceOnly(item: EvidenceItem): EvidenceReference {
  return {
    sourceKind: item.sourceKind,
    sourceId: item.sourceId,
    sourceRevision: item.sourceRevision,
    evidenceId: item.evidenceId,
    evidenceRevision: item.evidenceRevision,
    locator: item.locator,
    effectiveTime: item.effectiveTime,
    ...(item.unit === undefined ? {} : { unit: item.unit }),
    reviewState: item.reviewState,
  };
}
