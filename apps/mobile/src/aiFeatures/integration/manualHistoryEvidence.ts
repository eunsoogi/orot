import type { EvidenceItem, EvidenceReference } from '@orot/agent-runtime';
import type { ManualHistoryEvidence } from '@orot/domain';
import type { EvidenceChunk } from '@orot/rag';
import type { ManualHistoryRepository } from '@orot/storage';
import type {
  EvidenceSourceReadResult,
  LocalEvidenceReferenceRegistry,
} from './evidenceRegistry';
import { fingerprint } from './evidenceUtils';

const kindLabels: Record<ManualHistoryEvidence['kind'], string> = {
  diagnosis_history: '진단 또는 과거 병력',
  procedure: '시술 또는 수술',
  medication_context: '복용약 관련 내용',
  note: '자유 메모',
};

function content(entry: ManualHistoryEvidence): string {
  return [
    `기록 종류: ${kindLabels[entry.kind]}`,
    `기준일: ${entry.effectiveDate.status === 'known' ? entry.effectiveDate.date : '알 수 없음'}`,
    `출처: 사용자가 직접 입력`,
    `의료진 확인: ${entry.reviewState.status === 'reviewed' ? '확인됨' : '확인되지 않음'}`,
    `기록 내용: ${entry.text}`,
    ...(entry.correctionNote ? [`수정 메모: ${entry.correctionNote}`] : []),
  ].join('\n');
}

/** Exposes the effective date only for known-date history locators. */
export function manualHistoryEffectiveDate(
  item: EvidenceItem,
  registry?: LocalEvidenceReferenceRegistry,
): string | undefined {
  const locator = registry?.resolve(item)?.locator;
  if (!locator || typeof locator !== 'object' || Array.isArray(locator))
    return undefined;
  const candidate = locator as Readonly<Record<string, unknown>>;
  const dateValue = candidate.effectiveDate;
  if (!dateValue || typeof dateValue !== 'object' || Array.isArray(dateValue))
    return undefined;
  const date = dateValue as Readonly<Record<string, unknown>>;
  return date.status === 'known' && typeof date.date === 'string'
    ? date.date
    : undefined;
}

/** Produces the saved-summary record descriptor without persisting a turn-local alias. */
export function savedManualHistorySource(evidence: ManualHistoryEvidence) {
  return {
    kind: 'manual_history' as const,
    id: evidence.sourceEntryId,
    revision: fingerprint(evidence),
  };
}

/** Keeps the user's reported history explicit when a saved summary is restored. */
export function manualHistorySummaryReviewEvidence(
  reference: EvidenceReference,
  evidence: ManualHistoryEvidence,
): EvidenceItem {
  return {
    ...reference,
    content: 'manual_history: ' + JSON.stringify(evidence),
  };
}

/** Restores saved summary references only while their current entry revision matches. */
export async function readSavedManualHistorySource(
  source: { readonly id: string; readonly revision: string },
  repository: Pick<ManualHistoryRepository, 'getEvidence'>,
): Promise<EvidenceSourceReadResult> {
  const evidence = await repository.getEvidence(source.id);
  if (!evidence) return { status: 'missing' };
  if (fingerprint(evidence) !== source.revision) return { status: 'changed' };
  return {
    status: 'available',
    document: { sourceKind: 'manual_history', evidence },
  };
}

/** Adds current user-entered history to the same bounded, validated local RAG search. */
export function buildManualHistoryEvidence(input: {
  readonly candidates: readonly ManualHistoryEvidence[];
  readonly repository: Pick<ManualHistoryRepository, 'getEvidence'>;
  readonly registry: LocalEvidenceReferenceRegistry;
}): {
  readonly items: readonly EvidenceItem[];
  readonly chunks: readonly EvidenceChunk[];
} {
  const items: EvidenceItem[] = [];
  const chunks: EvidenceChunk[] = [];
  for (const entry of input.candidates) {
    const id = entry.sourceEntryId;
    const revision = fingerprint(entry);
    input.registry.registerSensitiveIdentifier(id);
    const text = content(entry);
    const item = input.registry.add({
      reference: {
        sourceKind: 'personal_record',
        sourceId: id,
        sourceRevision: revision,
        evidenceId: id,
        evidenceRevision: revision,
        locator: {
          kind: 'manual_history',
          entryId: id,
          effectiveDate: entry.effectiveDate,
        },
        // A date-only history entry has no precise instant; its date stays visible in the content.
        effectiveTime: null,
        reviewState:
          entry.reviewState.status === 'reviewed' ? 'reviewed' : 'unreviewed',
      },
      content: text,
      async validate(signal) {
        if (signal.aborted) return false;
        const current = await input.repository.getEvidence(id);
        return (
          !signal.aborted &&
          Boolean(current && fingerprint(current) === revision)
        );
      },
      async readSource(signal) {
        if (signal.aborted) return { status: 'unavailable' };
        const current = await input.repository.getEvidence(id);
        if (!current) return { status: 'missing' };
        if (fingerprint(current) !== revision) return { status: 'changed' };
        return {
          status: 'available',
          document: { sourceKind: 'manual_history', evidence: current },
        };
      },
    });
    items.push(item);
    chunks.push(
      input.registry.toSearchChunk(
        item,
        text,
        entry.reviewState,
        'evidence_span',
      ),
    );
  }
  return { items, chunks };
}
