import type { EvidenceItem, EvidenceSearchRequest } from '@orot/agent-runtime';
import { chunkStructuredRecord } from '@orot/rag';
import type {
  EvidenceChunk,
  HybridEvidenceSearchHit,
  HybridSearchOptions,
} from '@orot/rag';
import type { RecordMap } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { SqlCipherRagFullTextSearchStore } from '../../../storage/ragFullTextSearch';
import { evidenceRagSearchQuery } from '../../../healthEvidence/evidenceCandidateScope';
import { createLocalEvidenceSearchTool } from '../evidenceSearchTool';
import type { LocalEvidenceSnapshot } from '../evidenceSnapshot';
import {
  healthObservation,
  inventory,
} from '../testSupport/personalEvidenceTestSupport';

function evidence(id: string, content: string): EvidenceItem {
  return {
    sourceKind: 'personal_record',
    sourceId: id,
    sourceRevision: 'revision-1',
    evidenceId: id,
    evidenceRevision: 'revision-1',
    locator: { kind: 'structured_record', recordId: id },
    effectiveTime: '2026-10-18T08:00:00.000Z',
    reviewState: 'unreviewed',
    content,
  };
}

function chunk(
  id: string,
  text: string,
  recordType: EvidenceChunk['metadata']['recordType'] = 'health_observation',
): EvidenceChunk {
  return {
    id,
    text,
    metadata: {
      sourceId: id,
      sourceRecordIds: [id],
      evidenceId: id,
      evidenceLocator: { kind: 'structured_record', recordId: id },
      effectiveTime: '2026-10-18T08:00:00.000Z',
      recordType,
      reviewState: { status: 'unreviewed' },
    },
  };
}

function heartRateMeasurement(id: string, amount: number) {
  const record = healthObservation(id, []);
  const structuredRecord = {
    ...(record.record as RecordMap['health_observation']),
    concept: 'heart_rate',
    value: { kind: 'quantity' as const, amount, unit: 'count/min' },
  };
  return {
    item: evidence(id, `심박수 ${amount} count/min`),
    chunk: chunkStructuredRecord('health_observation', structuredRecord),
  };
}

// Exercises local search with machine-key chunks emitted by the production chunker.
test('Korean heart-rate search includes structured measurements without changing candidate query', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    const question = '최근 심박수 기록의 날짜와 수치';
    const measurements = Array.from({ length: 8 }, (_, index) =>
      heartRateMeasurement(`heart-rate-observation-${index + 1}`, 70 + index),
    );
    const distractors = [
      ...[
        'visit_question: 심박수 측정 기록에서 지속적인 변화를 어떻게 기록할까요?',
        'visit_question: 심박수 측정 기록 시 어떤 변화를 관찰할까요?',
        'visit_question: 다음 방문까지 기록할 수 있는 심박수 측정 변화는 무엇인가요?',
      ].map((text, index) => ({
        id: `visit-question-${index + 1}`,
        text,
        recordType: 'evidence_span' as const,
      })),
      ...[
        '내과 외래 진료 (합성 테스트)',
        '건강검진 검사 (합성 테스트)',
        '치과 정기검진 (합성 테스트)',
        '건강검진 검사 (합성 테스트)',
      ].map((title, index) => ({
        id: `appointment-${index + 1}`,
        text: `appointment: {"title":"${title}"}`,
        recordType: 'appointment' as const,
      })),
    ].map(value => ({
      item: evidence(value.id, value.text),
      chunk: chunk(value.id, value.text, value.recordType),
    }));
    const snapshotItems = [
      ...measurements.map(value => value.item),
      ...distractors.map(value => value.item),
    ];
    const snapshot: LocalEvidenceSnapshot = {
      inventory: inventory([]),
      items: snapshotItems,
      chunks: [
        ...measurements.map(value => value.chunk),
        ...distractors.map(value => value.chunk),
      ],
      coverage: [
        {
          sourceKind: 'personal_record',
          searchedSourceIds: snapshotItems.map(value => value.sourceId),
          gaps: [],
          truncated: false,
          selectionMethod: 'ranked_retrieval',
          resultLimit: 8,
          returnedCount: 0,
        },
      ],
      gaps: [],
      batchFor: selected => ({
        items: [...selected],
        coverage: [],
        conflicts: [],
      }),
    };
    const fullText = new SqlCipherRagFullTextSearchStore(database);
    const rag = {
      search: jest.fn(
        async (
          query: string,
          chunks: readonly EvidenceChunk[],
          limit = 8,
          options?: HybridSearchOptions,
        ): Promise<readonly HybridEvidenceSearchHit[]> => {
          const matches = await fullText.search(
            query,
            chunks,
            limit,
            options?.signal,
          );
          return matches.map((match, index) => ({
            chunk: chunks.find(value => value.id === match.chunkId)!,
            score: 1 / (index + 1),
            lexicalRank: index + 1,
            vectorRank: null,
          }));
        },
      ),
    };
    const loadSnapshot = jest.fn(async () => snapshot);
    const tool = createLocalEvidenceSearchTool({
      id: 'search_personal_record',
      sourceKind: 'personal_record',
      rag,
      loadSnapshot,
    });
    const request: EvidenceSearchRequest = {
      operationRunId: 'run-1',
      operationKey: 'tool-1',
      input: { query: question },
      allowedScope: { sourceKinds: ['personal_record'] },
      resultLimit: 8,
      maxPayloadBytes: 64 * 1024,
      signal: new AbortController().signal,
    };

    const result = await tool.search(request);
    if ('status' in result) throw new Error('Expected a local evidence batch.');

    const selectedMeasurements = result.items.filter(item =>
      item.evidenceId.startsWith('heart-rate-observation-'),
    );
    expect(selectedMeasurements.length).toBeGreaterThanOrEqual(4);
    expect(loadSnapshot).toHaveBeenCalledWith(question, request);
    expect(rag.search).toHaveBeenCalledWith(
      'heart_rate',
      snapshot.chunks,
      request.resultLimit,
      { signal: request.signal },
    );
  } finally {
    close();
  }
});

test.each([
  ['최근 혈압 기록', 'blood pressure'],
  ['최근 걸음 수', 'step_count'],
  ['최근 몸무게', 'body_mass'],
  ['최근 수면 기록', 'hkcategorytypeidentifiersleepanalysis'],
])(
  'uses the stored concept key for measurement-only request %s',
  (query, expected) => {
    expect(evidenceRagSearchQuery(query)).toBe(expected);
  },
);

test('leaves an unrelated Korean retrieval query unchanged', () => {
  const query = '최근 저장된 방문 질문';

  expect(evidenceRagSearchQuery(query)).toBe(query);
});
