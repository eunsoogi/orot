import type { EvidenceItem, EvidenceSearchRequest } from '@orot/agent-runtime';
import type {
  EvidenceChunk,
  HybridEvidenceSearchHit,
  HybridSearchOptions,
} from '@orot/rag';
import { chunkStructuredRecord } from '@orot/rag';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { SqlCipherRagFullTextSearchStore } from '../../../storage/ragFullTextSearch';
import { evidenceRagSearchQuery } from '../../../healthEvidence/evidenceCandidateScope';
import { createLocalEvidenceSearchTool } from '../evidenceSearchTool';
import type { LocalEvidenceSnapshot } from '../evidenceSnapshot';
import { inventory } from '../testSupport/personalEvidenceTestSupport';

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
  recordType: EvidenceChunk['metadata']['recordType'],
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

test('preserves symptom and visit-question intent in hybrid search with heart rate', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    const questions = [
      {
        query: '심박수 관련 저장된 진료 질문',
        expectedItems: ['heart-rate-observation', 'visit-question'],
      },
      {
        query: '심박수와 함께 나타난 어지럼 증상',
        expectedItems: ['heart-rate-observation', 'dizziness-symptom'],
      },
      {
        query: '심박수와 함께 나타난 어지럼 증상 진료 질문',
        expectedItems: [
          'heart-rate-observation',
          'dizziness-symptom',
          'visit-question',
        ],
      },
    ];
    const measurement = evidence(
      'heart-rate-observation',
      '심박수 72 count/min',
    );
    const dizziness = evidence('dizziness-symptom', '어지럼 증상');
    const visitQuestion = evidence(
      'visit-question',
      '심박수 관련 진료 질문으로 무엇을 물어볼까요?',
    );
    const chunks = [
      chunk(
        measurement.evidenceId,
        'health_observation: {"concept":"heart_rate","amount":72,"unit":"count/min"}',
        'health_observation',
      ),
      chunk(
        dizziness.evidenceId,
        'symptom_entry: 어지럼 증상과 심박수 변화',
        'symptom_entry',
      ),
      chunk(
        visitQuestion.evidenceId,
        'visit_question: 심박수 관련 진료 질문으로 무엇을 물어볼까요?',
        'evidence_span',
      ),
    ];
    const items = [measurement, dizziness, visitQuestion];
    const snapshot: LocalEvidenceSnapshot = {
      inventory: inventory([]),
      items,
      chunks,
      coverage: [
        {
          sourceKind: 'personal_record',
          searchedSourceIds: items.map(item => item.sourceId),
          gaps: [],
          truncated: false,
          selectionMethod: 'ranked_retrieval',
          resultLimit: 3,
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
    const search = jest.fn(
      async (
        query: string,
        searchChunks: readonly EvidenceChunk[],
        limit = 8,
        options?: HybridSearchOptions,
      ): Promise<readonly HybridEvidenceSearchHit[]> => {
        const matches = await fullText.search(
          query,
          searchChunks,
          limit,
          options?.signal,
        );
        return matches.map((match, index) => ({
          chunk: searchChunks.find(value => value.id === match.chunkId)!,
          score: 1 / (index + 1),
          lexicalRank: index + 1,
          vectorRank: null,
        }));
      },
    );
    const loadSnapshot = jest.fn(async () => snapshot);
    const tool = createLocalEvidenceSearchTool({
      id: 'search_personal_record',
      sourceKind: 'personal_record',
      rag: { search },
      loadSnapshot,
    });
    for (const { query, expectedItems } of questions) {
      const request: EvidenceSearchRequest = {
        operationRunId: 'run-1',
        operationKey: 'tool-1',
        input: { query },
        allowedScope: { sourceKinds: ['personal_record'] },
        resultLimit: 3,
        maxPayloadBytes: 64 * 1024,
        signal: new AbortController().signal,
      };
      const result = await tool.search(request);
      if ('status' in result)
        throw new Error('Expected a local evidence batch.');

      expect(result.items.map(item => item.evidenceId)).toEqual(
        expect.arrayContaining(expectedItems),
      );
      expect(loadSnapshot).toHaveBeenLastCalledWith(query, request);
      expect(search).toHaveBeenLastCalledWith(
        `heart_rate ${query}`,
        chunks,
        request.resultLimit,
        { signal: request.signal },
      );
      expect(evidenceRagSearchQuery(query)).toBe(`heart_rate ${query}`);
    }
  } finally {
    close();
  }
});

test('preserves a compound medication name when adding a sleep concept alias', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    const question = '수면제 복용 기록';
    const medication = chunkStructuredRecord('medication_definition', {
      id: 'sleep-medication',
      ingestedAt: '2026-10-18T08:00:00.000Z',
      provenance: { origin: 'imported', sourceRecordIds: ['sleep-medication'] },
      reviewState: { status: 'unreviewed' },
      medicationConceptIdentifier: 'synthetic-sleep-medication',
      displayText: '수면제',
      generalForm: 'tablet',
      isArchived: false,
      hasSchedule: false,
    });
    const sleepObservation = chunk(
      'sleep-observation',
      'health_observation: {"concept":"hkcategorytypeidentifiersleepanalysis","amount":8,"unit":"hours"}',
      'health_observation',
    );
    const fullText = new SqlCipherRagFullTextSearchStore(database);
    const matches = await fullText.search(
      evidenceRagSearchQuery(question),
      [medication, sleepObservation],
      2,
    );

    // The medication name is one FTS token, so its first syllable cannot stand in for the whole word.
    expect(matches.map(match => match.chunkId)).toEqual(
      expect.arrayContaining([medication.id, sleepObservation.id]),
    );
  } finally {
    close();
  }
});
