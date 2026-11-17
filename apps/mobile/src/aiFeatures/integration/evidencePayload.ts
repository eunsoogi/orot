import type {
  EvidenceBatch,
  EvidenceCoverage,
  EvidenceItem,
} from '@orot/agent-runtime';
import type { EvidenceChunk, HybridEvidenceSearchHit } from '@orot/rag';
import type { LocalE5RagService } from '../../rag/localE5RagService';
import type { RagConversationMessage } from '../../ragConversation/task';
import { providerHistoryMessage } from '../../ragConversation/conversationHistoryPayload';
import type { LocalEvidenceSnapshot } from './evidenceSnapshot';
import { localEvidenceKey } from './evidenceSnapshot';
const PAYLOAD_GAP = '일부 근거의 현재 출처를 확인하지 못했어요.';

function evidenceCoverage(
  snapshot: LocalEvidenceSnapshot,
  items: readonly EvidenceItem[],
  resultLimit: number,
  payloadLimited = false,
): EvidenceCoverage[] {
  return snapshot.coverage.map(value => {
    const selected = items.filter(item => item.sourceKind === value.sourceKind);
    const gaps =
      payloadLimited && !value.gaps.includes(PAYLOAD_GAP)
        ? [...value.gaps, PAYLOAD_GAP]
        : value.gaps;
    return {
      ...value,
      searchedSourceIds: [...new Set(selected.map(item => item.sourceId))],
      gaps,
      // Retain honest top-k limits without conflating them with unread or unsafe records.
      truncated:
        value.truncated ||
        payloadLimited ||
        selected.length <
          snapshot.items.filter(item => item.sourceKind === value.sourceKind)
            .length,
      resultLimit,
      returnedCount: selected.length,
    };
  });
}

/** Preserve complete ranked items without applying an unrelated serialized-size allowance. */
export function selectInitialEvidence(
  snapshot: LocalEvidenceSnapshot,
  hits: readonly HybridEvidenceSearchHit[],
): EvidenceBatch {
  const byKey = new Map(
    snapshot.items.map(item => [localEvidenceKey(item), item]),
  );
  const selected: EvidenceItem[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const key = localEvidenceKey(hit.chunk.metadata);
    const item = byKey.get(key);
    if (!item || seen.has(key)) continue;
    selected.push(item);
    seen.add(key);
  }

  const result: EvidenceBatch = {
    items: selected,
    coverage: evidenceCoverage(snapshot, selected, Math.max(1, hits.length)),
    conflicts: [],
  };
  return result;
}

export interface BoundedRagSelection {
  readonly items: readonly EvidenceItem[];
  readonly coverage: readonly EvidenceCoverage[];
  readonly omittedForPayload: boolean;
}

/** Abort only when selected source evidence cannot be resolved, never because of serialized size. */
export function createPayloadBoundedRagSearch(input: {
  readonly rag: Pick<LocalE5RagService, 'search'>;
  readonly snapshot: LocalEvidenceSnapshot;
  readonly abort: () => void;
  readonly onSelection: (selection: BoundedRagSelection) => void;
}): {
  readonly rag: Pick<LocalE5RagService, 'search'>;
  didOmitEvidence(): boolean;
} {
  let omittedForPayload = false;
  const byKey = new Map(
    input.snapshot.items.map(item => [localEvidenceKey(item), item]),
  );
  return {
    rag: {
      async search(
        query: string,
        chunks: readonly EvidenceChunk[],
        limit?: number,
        options?: Parameters<LocalE5RagService['search']>[3],
      ) {
        const resultLimit = limit ?? 5;
        const hits = await input.rag.search(
          query,
          chunks,
          resultLimit,
          options,
        );
        const selected: EvidenceItem[] = [];
        const selectedHits: HybridEvidenceSearchHit[] = [];
        const seen = new Set<string>();
        for (const hit of hits.slice(0, resultLimit)) {
          const key = localEvidenceKey(hit.chunk.metadata);
          const item = byKey.get(key);
          if (!item || seen.has(key)) {
            omittedForPayload ||= !item;
            continue;
          }
          selected.push(item);
          selectedHits.push(hit);
          seen.add(key);
        }
        const selection: BoundedRagSelection = {
          items: selected,
          coverage: evidenceCoverage(
            input.snapshot,
            selected,
            resultLimit,
            omittedForPayload,
          ),
          omittedForPayload,
        };
        input.onSelection(selection);
        if (omittedForPayload) input.abort();
        return selectedHits;
      },
    },
    didOmitEvidence: () => omittedForPayload,
  };
}

/** Preserve eligible user context; citations still come only from revalidated sources. */
export function boundRagConversationHistory(
  messages: readonly RagConversationMessage[],
): readonly RagConversationMessage[] {
  return messages
    .map(providerHistoryMessage)
    .filter(message => message.content.length > 0);
}
