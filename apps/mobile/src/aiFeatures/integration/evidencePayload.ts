import type {
  EvidenceBatch,
  EvidenceCoverage,
  EvidenceItem,
} from '@orot/agent-runtime';
import type { EvidenceChunk, HybridEvidenceSearchHit } from '@orot/rag';
import type { LocalE5RagService } from '../../rag/localE5RagService';
import type { RagConversationMessage } from '../../ragConversation/task';
import type { LocalEvidenceSnapshot } from './evidenceSnapshot';
import { localEvidenceKey } from './evidenceSnapshot';
import {
  jsonByteLength,
  MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES,
  utf8ByteLength,
} from './evidenceUtils';

const MAX_INITIAL_EVIDENCE_ITEMS = 8;
const MAX_RAG_HISTORY_BYTES = 4 * 1024;
const PAYLOAD_GAP = '일부 근거가 요청 크기 제한으로 제외되었어요.';

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
      truncated: value.truncated || payloadLimited,
      resultLimit,
      returnedCount: selected.length,
    };
  });
}

/** Selects only complete evidence items that fit the workflow's request budget. */
export function selectInitialEvidence(
  snapshot: LocalEvidenceSnapshot,
  hits: readonly HybridEvidenceSearchHit[],
): EvidenceBatch {
  const byKey = new Map(
    snapshot.items.map(item => [localEvidenceKey(item), item]),
  );
  const selected: EvidenceItem[] = [];
  const omittedKinds = new Set<EvidenceItem['sourceKind']>();
  const seen = new Set<string>();
  for (const hit of hits.slice(0, MAX_INITIAL_EVIDENCE_ITEMS)) {
    const key = localEvidenceKey(hit.chunk.metadata);
    const item = byKey.get(key);
    if (!item || seen.has(key)) continue;
    const candidate = [...selected, item];
    const batch = {
      items: candidate,
      coverage: evidenceCoverage(
        snapshot,
        candidate,
        MAX_INITIAL_EVIDENCE_ITEMS,
      ),
      conflicts: [],
    } satisfies EvidenceBatch;
    if (jsonByteLength(batch) > MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES) {
      omittedKinds.add(item.sourceKind);
      continue;
    }
    selected.push(item);
    seen.add(key);
  }

  const result: EvidenceBatch = {
    items: selected,
    coverage: evidenceCoverage(snapshot, selected, MAX_INITIAL_EVIDENCE_ITEMS),
    conflicts: [],
  };
  if (hits.length > MAX_INITIAL_EVIDENCE_ITEMS) {
    for (const hit of hits.slice(MAX_INITIAL_EVIDENCE_ITEMS)) {
      const item = byKey.get(localEvidenceKey(hit.chunk.metadata));
      if (item) omittedKinds.add(item.sourceKind);
    }
  }
  if (omittedKinds.size === 0) return result;
  return {
    ...result,
    coverage: result.coverage.map(value =>
      omittedKinds.has(value.sourceKind)
        ? {
            ...value,
            gaps: [...value.gaps, PAYLOAD_GAP],
            truncated: true,
          }
        : value,
    ),
  };
}

export interface BoundedRagSelection {
  readonly items: readonly EvidenceItem[];
  readonly coverage: readonly EvidenceCoverage[];
  readonly omittedForPayload: boolean;
}

/** Bounds fresh RAG evidence before any provider call and aborts when a relevant hit must be omitted. */
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
          const candidate = [...selected, item];
          const candidateBatch = {
            items: candidate,
            coverage: evidenceCoverage(input.snapshot, candidate, resultLimit),
            conflicts: [],
          } satisfies EvidenceBatch;
          if (
            jsonByteLength(candidateBatch) > MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES
          ) {
            omittedForPayload = true;
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

function utf8Suffix(value: string, maxBytes: number): string {
  let start = value.length;
  let remaining = maxBytes;
  while (start > 0) {
    let codePointStart = start - 1;
    const lastUnit = value.charCodeAt(codePointStart);
    if (
      lastUnit >= 0xdc00 &&
      lastUnit <= 0xdfff &&
      codePointStart > 0 &&
      value.charCodeAt(codePointStart - 1) >= 0xd800 &&
      value.charCodeAt(codePointStart - 1) <= 0xdbff
    ) {
      codePointStart -= 1;
    }
    const bytes = utf8ByteLength(value.slice(codePointStart, start));
    if (bytes > remaining) break;
    remaining -= bytes;
    start = codePointStart;
  }
  return value.slice(start);
}

function lastUtf16Units(value: string, maxUnits: number): string {
  let start = Math.max(0, value.length - maxUnits);
  if (
    start > 0 &&
    start < value.length &&
    value.charCodeAt(start) >= 0xdc00 &&
    value.charCodeAt(start) <= 0xdfff &&
    value.charCodeAt(start - 1) >= 0xd800 &&
    value.charCodeAt(start - 1) <= 0xdbff
  ) {
    start += 1;
  }
  return value.slice(start);
}

/** Keeps only recent chat text within a small UTF-8 allowance; citations always come from fresh records. */
export function boundRagConversationHistory(
  messages: readonly RagConversationMessage[],
): readonly RagConversationMessage[] {
  let remaining = MAX_RAG_HISTORY_BYTES;
  const bounded: RagConversationMessage[] = [];
  for (const message of messages.slice(-8).reverse()) {
    if (remaining === 0) break;
    const content = utf8Suffix(
      lastUtf16Units(message.content, 2000),
      remaining,
    );
    if (!content) continue;
    remaining -= utf8ByteLength(content);
    bounded.push({ role: message.role, content });
  }
  return bounded.reverse();
}
