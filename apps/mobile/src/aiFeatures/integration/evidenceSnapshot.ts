import type { EvidenceBatch, EvidenceItem } from '@orot/agent-runtime';
import type {
  AgentMemoryStorageAdapter,
  PersistedMemoryRecord,
} from '@orot/agent-memory';
import type { EvidenceChunk } from '@orot/rag';
import type {
  LocalHealthEvidenceInventory,
  LocalHealthEvidenceRepository,
} from '../../healthEvidence/localEvidenceRepository';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import {
  buildMemoryEvidence,
  registerMemoryIdentifiers,
} from './memoryEvidence';
import { buildPersonalEvidence } from './personalEvidence';
import type { StaleEvidenceArtifact } from './localData';

export interface LocalEvidenceSnapshot {
  readonly inventory: LocalHealthEvidenceInventory;
  readonly items: readonly EvidenceItem[];
  readonly chunks: readonly EvidenceChunk[];
  readonly coverage: EvidenceBatch['coverage'];
  readonly gaps: readonly string[];
  batchFor(items: readonly EvidenceItem[], resultLimit: number): EvidenceBatch;
}

export function localEvidenceKey(value: {
  readonly sourceId: string;
  readonly evidenceId: string;
}): string {
  return `${value.sourceId}\u0000${value.evidenceId}`;
}

function inventoryGaps(inventory: LocalHealthEvidenceInventory): string[] {
  return inventory.inventoryComplete
    ? []
    : ['로컬 기록이 저장 상한을 넘어 전체 자료를 포함하지 못했어요.'];
}

export async function createLocalEvidenceSnapshot(input: {
  readonly inventory: LocalHealthEvidenceInventory;
  readonly persistedChunks: readonly EvidenceChunk[];
  readonly loadCurrentPersistedChunks: () => Promise<readonly EvidenceChunk[]>;
  readonly staleArtifacts: readonly StaleEvidenceArtifact[];
  readonly loadCurrentStaleArtifacts: () => Promise<
    readonly StaleEvidenceArtifact[]
  >;
  readonly repository: LocalHealthEvidenceRepository;
  readonly memoryRecords: readonly PersistedMemoryRecord[];
  readonly memoryStorage: Pick<AgentMemoryStorageAdapter, 'listRecords'>;
  readonly registry: LocalEvidenceReferenceRegistry;
}): Promise<LocalEvidenceSnapshot> {
  // Register both stores before serializing any content so cross-record IDs are redacted too.
  registerMemoryIdentifiers(input.memoryRecords, input.registry);
  const personal = buildPersonalEvidence(input);
  const memory = await buildMemoryEvidence({
    records: input.memoryRecords,
    storage: input.memoryStorage,
    registry: input.registry,
  });
  const items = [...personal.items, ...memory.items];
  const chunks = [...personal.chunks, ...memory.chunks];
  const memoryGaps =
    memory.excludedCount > 0
      ? ['일부 로컬 기억을 안전하게 확인할 수 없어 검색에서 제외했어요.']
      : [];
  const personalGaps = inventoryGaps(input.inventory);
  const gaps = [...personalGaps, ...memoryGaps];
  const forSource = (sourceKind: EvidenceItem['sourceKind']) =>
    items.filter(item => item.sourceKind === sourceKind);
  const coverage: EvidenceBatch['coverage'] = [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: [
        ...new Set(forSource('personal_record').map(item => item.sourceId)),
      ],
      gaps: personalGaps,
      truncated: !input.inventory.inventoryComplete,
      resultLimit: 8,
      returnedCount: 0,
    },
    {
      sourceKind: 'reviewed_memory',
      searchedSourceIds: [
        ...new Set(forSource('reviewed_memory').map(item => item.sourceId)),
      ],
      gaps: memoryGaps,
      truncated: memory.excludedCount > 0,
      resultLimit: 8,
      returnedCount: 0,
    },
  ];

  return {
    inventory: input.inventory,
    items,
    chunks,
    coverage,
    gaps,
    batchFor(selectedItems, resultLimit) {
      if (
        !Number.isInteger(resultLimit) ||
        resultLimit < 1 ||
        resultLimit > 8 ||
        selectedItems.length > resultLimit
      ) {
        throw new RangeError(
          'Evidence selections must fit the multi-agent item limit.',
        );
      }
      const counts = new Map<string, number>();
      for (const item of selectedItems) {
        counts.set(item.sourceKind, (counts.get(item.sourceKind) ?? 0) + 1);
      }
      return {
        items: [...selectedItems],
        coverage: coverage.map(value => ({
          ...value,
          // Only disclose source aliases present in this bounded evidence batch.
          searchedSourceIds: [
            ...new Set(
              selectedItems
                .filter(item => item.sourceKind === value.sourceKind)
                .map(item => item.sourceId),
            ),
          ],
          resultLimit,
          returnedCount: counts.get(value.sourceKind) ?? 0,
        })),
        conflicts: [],
      };
    },
  };
}
