import type {
  AgentMemoryStorageAdapter,
  PersistedMemoryRecord,
} from '@orot/agent-memory';
import type { EvidenceChunk } from '@orot/rag';
import { createAppleSelectionOption } from '../../providers/selection/options';
import type { ProviderSelectionStore } from '../../providers/selection/types';
import type { LocalHealthEvidenceInventory } from '../../healthEvidence/localEvidenceRepository';
import type { MultiAgentWorkflowOptions } from '@orot/agent-runtime';
import type { AiFeatureLocalData } from './localData';

export const apple = createAppleSelectionOption('available');
export const consent = {
  authorize: jest.fn(async () => 'authorized' as const),
} as MultiAgentWorkflowOptions['consent'];

export const completeInventory: LocalHealthEvidenceInventory = {
  inventoryComplete: true,
  availableKinds: [],
  queriedKinds: [],
  unsupportedKinds: [],
  truncatedKinds: [],
  records: [],
  recordCount: 0,
};

export function memoryRecord(index: number): PersistedMemoryRecord {
  return {
    id: `memory-private-${index}`,
    text: `기억 내용 ${index}, source-private-${index}`,
    tags: ['preference'],
    entities: [],
    vector: new Float32Array([0.1]),
    importance: 0.8,
    meta: {
      memoryKey: `memory-key-${index}`,
      kind: 'preference',
      provenance: {
        sourceIds: [`source-private-${index}`],
        reviewState: 'user_confirmed',
      },
    },
    createdAt: Date.UTC(2026, 0, index + 1),
    reinforcements: 0,
  } as unknown as PersistedMemoryRecord;
}

export function selectionStore(
  selection: { providerId: string; modelId: string } | null,
): ProviderSelectionStore {
  return {
    load: jest.fn(async () => selection),
    save: jest.fn(),
    clear: jest.fn(),
  };
}

export function localData(records: readonly PersistedMemoryRecord[]): {
  readonly data: AiFeatureLocalData;
  readonly searchedChunks: EvidenceChunk[][];
  readonly indexedChunks: EvidenceChunk[][];
  readonly eventOrder: string[];
  replaceMemoryRecords(records: readonly PersistedMemoryRecord[]): void;
} {
  let currentRecords = [...records];
  const searchedChunks: EvidenceChunk[][] = [];
  const indexedChunks: EvidenceChunk[][] = [];
  const eventOrder: string[] = [];
  const rag = {
    index: jest.fn(async (chunks: readonly EvidenceChunk[]) => {
      indexedChunks.push([...chunks]);
      eventOrder.push('index');
    }),
    search: jest.fn(
      async (_query: string, chunks: readonly EvidenceChunk[]) => {
        searchedChunks.push([...chunks]);
        eventOrder.push('search');
        return chunks.map(chunk => ({ chunk, score: 1 })) as never;
      },
    ),
  };
  const memoryStorage: Pick<AgentMemoryStorageAdapter, 'listRecords'> = {
    listRecords: jest.fn(async () => [...currentRecords]),
  };
  return {
    searchedChunks,
    indexedChunks,
    eventOrder,
    replaceMemoryRecords(nextRecords) {
      currentRecords = [...nextRecords];
    },
    data: {
      repository: { readRecord: jest.fn(async () => null) } as never,
      rag: rag as never,
      memoryStorage,
      loadInventory: jest.fn(async () => completeInventory),
      loadPersistedChunks: jest.fn(async () => []),
      loadStaleArtifacts: jest.fn(async () => []),
      loadMemoryRecords: jest.fn(async () => [...currentRecords]),
    },
  };
}
