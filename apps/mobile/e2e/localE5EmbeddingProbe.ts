import type { EmbeddingIndexProgress, EvidenceChunk } from '@orot/rag';
import { cancelOneInFlightBatch } from './localE5CancellationProbe';
import { openLocalE5RagService } from '../src/rag/localE5RagService';
import {
  getLocalE5NativeModelIdentity,
  getLocalE5NativeRuntimeMetrics,
} from '../src/rag/localE5NativeBackend';
import { SqlCipherRagEmbeddingStorage } from '../src/storage/ragEmbeddingStorage';
import { openLocalAgentMemoryDatabase } from '../src/storage/secureDatabase';

export type LocalE5ProbeMode = 'fresh' | 'restart';

const corpus = [
  chunk(
    'korean-bp-medication',
    '혈압약 아모디핀 5mg을 매일 아침 8시에 복용했습니다.',
  ),
  chunk(
    'korean-stomach-symptom',
    '점심 식사 후 명치 부위가 쓰렸고 제산제를 복용한 뒤 20분 정도 지나 호전되었습니다.',
  ),
  chunk(
    'korean-sleep',
    '어젯밤 오후 11시에 잠들어 오늘 오전 6시에 일어났고 7시간 잤습니다.',
  ),
  chunk(
    'korean-walk',
    '저녁 식사 후 30분 걸었으며 숨이 차거나 어지럽지는 않았습니다.',
  ),
  chunk('korean-lab', '다음 주 월요일 오전 9시에 혈액검사 예약이 있습니다.'),
  chunk('korean-weight', '체중은 70.5kg으로 지난주와 비슷했습니다.'),
];

const retrievalCases = [
  {
    query: '고혈압 조절을 위해 아침에 먹는 약과 용량은?',
    expected: 'korean-bp-medication',
  },
  {
    query: '속 쓰림이 생긴 뒤 무엇을 복용했고 언제 좋아졌나요?',
    expected: 'korean-stomach-symptom',
  },
  {
    query: '잠든 시각과 일어난 시각, 총 수면 시간은?',
    expected: 'korean-sleep',
  },
  {
    query: '산책을 하고 나서 호흡이나 어지러움이 있었나요?',
    expected: 'korean-walk',
  },
  { query: '다음 혈액검사 일정은 언제인가요?', expected: 'korean-lab' },
];

export interface LocalE5ProbeResult {
  readonly mode: LocalE5ProbeMode;
  readonly modelIdentityMatches: boolean;
  readonly persistedVectorCount: number;
  readonly top1: number;
  readonly recallAt3: number;
  readonly meanReciprocalRank: number;
  readonly retrievalMilliseconds: readonly number[];
  readonly progressEvents: number;
  readonly progressMonotonic: boolean;
  readonly cancellation?: 'cancelled' | 'completed-before-cancel';
  /** Time until the native bridge rejects the in-flight batch promise. */
  readonly cancellationResponseMilliseconds?: number;
  /** Time until the follow-up actor call runs after synchronous ORT inference drains. */
  readonly cancellationSettlementMilliseconds?: number;
  readonly runtime: Awaited<ReturnType<typeof getLocalE5NativeRuntimeMetrics>>;
}

export async function runLocalE5EmbeddingProbe(
  mode: LocalE5ProbeMode,
): Promise<LocalE5ProbeResult> {
  const service = await openLocalE5RagService();
  const identity = await getLocalE5NativeModelIdentity();
  const identityMatches = Object.keys(service.provider.modelIdentity).every(
    key =>
      service.provider.modelIdentity[key as keyof typeof identity] ===
      identity[key as keyof typeof identity],
  );
  if (!identityMatches)
    throw new Error(
      'The native model identity does not match the provider identity.',
    );

  const progress: EmbeddingIndexProgress[] = [];
  let cancellation: LocalE5ProbeResult['cancellation'];
  let cancellationResponseMilliseconds: number | undefined;
  let cancellationSettlementMilliseconds: number | undefined;
  if (mode === 'fresh') {
    await service.index(corpus, {
      batchSize: 4,
      onProgress: value => progress.push(value),
    });
    const cancelResult = await cancelOneInFlightBatch();
    cancellation = cancelResult.outcome;
    cancellationResponseMilliseconds = cancelResult.responseMilliseconds;
    cancellationSettlementMilliseconds = cancelResult.settlementMilliseconds;
    if (cancellation !== 'cancelled') {
      throw new Error(
        'The in-flight native embedding batch completed before cancellation was observed.',
      );
    }
    if (
      typeof cancellationResponseMilliseconds !== 'number' ||
      typeof cancellationSettlementMilliseconds !== 'number' ||
      !Number.isFinite(cancellationResponseMilliseconds) ||
      !Number.isFinite(cancellationSettlementMilliseconds) ||
      cancellationResponseMilliseconds < 0 ||
      cancellationSettlementMilliseconds < cancellationResponseMilliseconds
    ) {
      throw new Error(
        'The Simulator did not record ordered cancellation response and settlement times.',
      );
    }
  }

  const storage = new SqlCipherRagEmbeddingStorage(
    await openLocalAgentMemoryDatabase(),
  );
  const persistedVectorCount = (
    await storage.listForModel(service.provider.modelIdentity)
  ).length;
  if (persistedVectorCount !== corpus.length) {
    throw new Error(
      'The on-device vector index did not retain every synthetic document.',
    );
  }

  const retrievalMilliseconds: number[] = [];
  const reciprocalRanks: number[] = [];
  let top1 = 0;
  let recallAt3 = 0;
  for (const testCase of retrievalCases) {
    const start = Date.now();
    const hits = await service.search(testCase.query, corpus, 3);
    retrievalMilliseconds.push(Date.now() - start);
    const rank = hits.findIndex(hit => hit.chunk.id === testCase.expected);
    if (rank === 0) top1 += 1;
    if (rank >= 0) {
      recallAt3 += 1;
      reciprocalRanks.push(1 / (rank + 1));
    } else {
      reciprocalRanks.push(0);
    }
  }
  const progressSteps = progress.filter(
    item => item.stage === 'model_download',
  );
  const progressMonotonic = progressSteps.every(
    (item, index) =>
      index === 0 || item.completed >= progressSteps[index - 1].completed,
  );
  const runtime = await getLocalE5NativeRuntimeMetrics();
  if (
    progressSteps.length === 0 ||
    !runtime.modelLoaded ||
    runtime.downloadMilliseconds === null ||
    runtime.sessionLoadMilliseconds === null ||
    runtime.footprintAfterLoadBytes === null ||
    runtime.inferenceMilliseconds === null ||
    runtime.inferencePeakFootprintBytes === null
  ) {
    throw new Error(
      'The Simulator did not produce complete progress, memory, and latency measurements.',
    );
  }
  const result: LocalE5ProbeResult = {
    mode,
    modelIdentityMatches: identityMatches,
    persistedVectorCount,
    top1,
    recallAt3,
    meanReciprocalRank:
      reciprocalRanks.reduce((sum, rank) => sum + rank, 0) /
      reciprocalRanks.length,
    retrievalMilliseconds,
    progressEvents: progressSteps.length,
    progressMonotonic,
    cancellation,
    cancellationResponseMilliseconds,
    cancellationSettlementMilliseconds,
    runtime,
  };
  if (!progressMonotonic)
    throw new Error('Model download progress moved backwards.');
  if (top1 < 4 || result.meanReciprocalRank < 0.8) {
    throw new Error(
      'The Korean retrieval fixture did not meet its top-1 and reciprocal-rank targets.',
    );
  }
  if (recallAt3 !== retrievalCases.length) {
    throw new Error(
      'The Korean retrieval fixture did not find every expected record in the top three.',
    );
  }
  return result;
}

function chunk(id: string, text: string): EvidenceChunk {
  return {
    id,
    text,
    metadata: {
      sourceId: id,
      sourceRecordIds: [id],
      evidenceId: id,
      evidenceLocator: { kind: 'structured_record', recordId: id },
      effectiveTime: null,
      recordType: 'symptom_entry',
      reviewState: { status: 'unreviewed' },
    },
  };
}
