import { isSQLCipher } from '@op-engineering/op-sqlite';
import type { EvidenceChunk, HybridEvidenceSearchHit } from '@orot/rag';
import { openLocalE5RagService } from '../src/rag/localE5RagService';
import { SqlCipherRagEmbeddingStorage } from '../src/storage/ragEmbeddingStorage';
import {
  getCipherVersion,
  openLocalAgentMemoryDatabase,
} from '../src/storage/secureDatabase';

const medicationText = '혈압약 아모디핀 5mg을 매일 아침 복용했습니다.';

const medication = chunk({
  id: 'issue25-synthetic-medication',
  text: medicationText,
  effectiveTime: '2026-01-02T08:00:00.000Z',
  recordType: 'medication_assertion',
  encounterId: 'issue25-synthetic-encounter',
  reviewState: {
    status: 'reviewed',
    reviewerId: 'synthetic-reviewer',
    reviewedAt: '2026-01-02T08:01:00.000Z',
  },
  locator: {
    kind: 'text_range',
    startOffset: 0,
    endOffset: medicationText.length,
  },
});

const sleep = chunk({
  id: 'issue25-synthetic-sleep',
  text: '어젯밤 오후 11시에 잠들어 오늘 오전 6시에 일어났고 7시간 잤습니다.',
  effectiveTime: '2026-01-03T07:00:00.000Z',
  recordType: 'symptom_entry',
  reviewState: { status: 'needs_review', reason: 'Synthetic pending review.' },
  locator: { kind: 'audio_time_range', startMs: 250, endMs: 1800 },
});

const corpus = [medication, sleep];

export interface Issue25HybridProbeResult {
  readonly mode: 'indexed' | 'reopened';
  readonly sqlCipherEnabled: boolean;
  readonly cipherVersion: string | null;
  readonly tempStoreMode: number | null;
  readonly remainingVectorCount: number;
  readonly ftsOnly: {
    readonly id: string;
    readonly lexicalRank: number | null;
    readonly vectorRank: number | null;
  };
  readonly vectorOnly: {
    readonly id: string;
    readonly lexicalRank: number | null;
    readonly vectorRank: number | null;
  };
  readonly filtersApplied: boolean;
  readonly locatorPreserved: boolean;
  readonly temporaryTablesCleaned: boolean;
}

function chunk(input: {
  id: string;
  text: string;
  effectiveTime: string;
  recordType: EvidenceChunk['metadata']['recordType'];
  encounterId?: string;
  reviewState: EvidenceChunk['metadata']['reviewState'];
  locator: EvidenceChunk['metadata']['evidenceLocator'];
}): EvidenceChunk {
  return {
    id: input.id,
    text: input.text,
    metadata: {
      sourceId: input.id,
      sourceRecordIds: [input.id],
      evidenceId: `${input.id}-evidence`,
      evidenceLocator: input.locator,
      effectiveTime: input.effectiveTime,
      recordType: input.recordType,
      reviewState: input.reviewState,
      ...(input.encounterId ? { encounterId: input.encounterId } : {}),
    },
  };
}

function summarize(hit: HybridEvidenceSearchHit | undefined) {
  if (!hit)
    throw new Error('The local hybrid search returned no expected evidence.');
  return {
    id: hit.chunk.id,
    lexicalRank: hit.lexicalRank,
    vectorRank: hit.vectorRank,
    locator: hit.chunk.metadata.evidenceLocator,
    reviewState: hit.chunk.metadata.reviewState.status,
  };
}

export async function runIssue25HybridRetrievalProbe(): Promise<Issue25HybridProbeResult> {
  const service = await openLocalE5RagService();
  const database = await openLocalAgentMemoryDatabase();
  const cipherVersion = await getCipherVersion();
  if (!isSQLCipher() || !cipherVersion) {
    throw new Error(
      'The issue-25 probe requires the native SQLCipher database.',
    );
  }

  const vectorStorage = new SqlCipherRagEmbeddingStorage(database);
  const indexedVectors = await vectorStorage.listForModel(
    service.provider.modelIdentity,
  );
  let mode: Issue25HybridProbeResult['mode'];
  if (indexedVectors.length === 0) {
    mode = 'indexed';
    await service.index(corpus, { batchSize: 2 });
    if (
      (await vectorStorage.listForModel(service.provider.modelIdentity))
        .length !== corpus.length
    ) {
      throw new Error(
        'The SQLCipher vector index did not retain the synthetic corpus.',
      );
    }
    // Leave one synthetic vector so relaunch can prove persistence without re-indexing.
    const deleted = await database.execute(
      'DELETE FROM rag_embeddings WHERE chunk_id = ? AND model_id = ? AND model_revision = ?',
      [
        medication.id,
        service.provider.modelIdentity.id,
        service.provider.modelIdentity.revision,
      ],
    );
    if (deleted.rowsAffected !== 1) {
      throw new Error(
        'The synthetic vector setup did not remove exactly one medication vector.',
      );
    }
  } else if (
    indexedVectors.length === 1 &&
    indexedVectors[0]?.chunkId === sleep.id
  ) {
    // Re-query the retained vector after process restart; indexing here would hide a persistence failure.
    mode = 'reopened';
  } else {
    throw new Error(
      'The SQLCipher store has an unexpected vector state for this synthetic probe.',
    );
  }

  const ftsHits = await service.search('혈압약', corpus, 2, {
    filters: {
      timeRange: {
        start: '2026-01-02T08:00:00.000Z',
        end: '2026-01-02T08:00:00.000Z',
      },
      recordTypes: ['medication_assertion'],
      encounterId: 'issue25-synthetic-encounter',
      reviewStates: ['reviewed'],
    },
  });
  const ftsOnly = summarize(ftsHits[0]);
  if (
    ftsOnly.id !== medication.id ||
    ftsOnly.vectorRank !== null ||
    ftsOnly.lexicalRank === null
  ) {
    throw new Error(
      'The SQLCipher FTS candidate did not remain searchable after vector removal.',
    );
  }

  const vectorHits = await service.search(
    '잠든 시각과 일어난 시각, 총 수면 시간은?',
    corpus,
    2,
    {
      filters: {
        timeRange: {
          start: '2026-01-03T07:00:00.000Z',
          end: '2026-01-03T07:00:00.000Z',
        },
        recordTypes: ['symptom_entry'],
        reviewStates: ['needs_review'],
      },
    },
  );
  const vectorOnly = summarize(vectorHits[0]);
  if (
    vectorOnly.id !== sleep.id ||
    vectorOnly.lexicalRank !== null ||
    vectorOnly.vectorRank === null
  ) {
    throw new Error(
      'The E5 vector candidate did not survive without a lexical match.',
    );
  }

  const tempStore = await database.execute('PRAGMA temp_store');
  const tempTables = await database.execute(
    "SELECT name FROM sqlite_temp_master WHERE name LIKE 'rag_fts_query_%'",
  );
  const remainingVectors = await vectorStorage.listForModel(
    service.provider.modelIdentity,
  );
  const result: Issue25HybridProbeResult = {
    mode,
    sqlCipherEnabled: true,
    cipherVersion,
    tempStoreMode:
      typeof tempStore.rows[0]?.temp_store === 'number'
        ? tempStore.rows[0].temp_store
        : null,
    remainingVectorCount: remainingVectors.length,
    ftsOnly,
    vectorOnly,
    filtersApplied:
      ftsOnly.id === medication.id &&
      ftsOnly.reviewState === 'reviewed' &&
      vectorOnly.id === sleep.id &&
      vectorOnly.reviewState === 'needs_review',
    locatorPreserved:
      JSON.stringify(ftsOnly.locator) ===
        JSON.stringify(medication.metadata.evidenceLocator) &&
      JSON.stringify(vectorOnly.locator) ===
        JSON.stringify(sleep.metadata.evidenceLocator),
    temporaryTablesCleaned: tempTables.rows.length === 0,
  };
  if (
    result.tempStoreMode !== 2 ||
    result.remainingVectorCount !== corpus.length - 1 ||
    !result.filtersApplied ||
    !result.locatorPreserved ||
    !result.temporaryTablesCleaned
  ) {
    throw new Error(
      `The issue-25 SQLCipher/FTS result is incomplete: ${JSON.stringify(result)}`,
    );
  }
  return result;
}
