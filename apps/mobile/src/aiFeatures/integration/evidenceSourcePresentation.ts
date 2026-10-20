import {
  fieldLabels,
  visibleValue,
  isPrivateIdentifier,
} from './evidenceSourceValues';
import type { PersistedMemoryRecord } from '@orot/agent-memory';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceRepository';
import type { EvidenceSourceDocument } from './evidenceRegistry';
import { presentHealthContext } from './healthContextPresentation';
import {
  evidenceRecordHero,
  type EvidenceRecordHero,
} from './evidenceRecordHero';

export interface EvidenceSourceDetailRow {
  readonly label: string;
  readonly value: string;
}

export interface EvidenceSourceDetailSection {
  readonly title: string;
  readonly rows: readonly EvidenceSourceDetailRow[];
  readonly hero?: EvidenceRecordHero;
}

// Import bookkeeping is useful for sync recovery, but does not describe the cited health event.
const managementFields = new Set([
  'ingestedAt',
  'recordedAt',
  'createdAt',
  'provenance',
  'reviewState',
  'isArchived',
  'hasSchedule',
  'generalForm',
  'observationKind',
  'device',
  'manufacturer',
  'productType',
  'sourceVersion',
]);

function personalRecordRows(
  entry: LocalHealthEvidenceRecord,
): EvidenceSourceDetailRow[] {
  const record = entry.record as unknown as Record<string, unknown>;
  const rows: EvidenceSourceDetailRow[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (
      !fieldLabels[key] ||
      isPrivateIdentifier(key) ||
      managementFields.has(key)
    )
      continue;
    const rendered = visibleValue(value, key);
    if (rendered)
      rows.push({ label: fieldLabels[key] ?? key, value: rendered });
  }
  const provenance = record.provenance as
    { origin?: unknown; source?: Record<string, unknown> } | undefined;
  const source = provenance?.source;
  if (source) {
    const rendered =
      visibleValue(source.sourceName) ?? visibleValue(source.system, 'system');
    if (rendered) rows.push({ label: '출처', value: rendered });
  }
  return rows;
}

function recordTitle(entry: LocalHealthEvidenceRecord): string {
  const labels: Partial<Record<LocalHealthEvidenceRecord['kind'], string>> = {
    appointment: '예약 기록',
    dose_event: '복용 기록',
    encounter: '진료 기록',
    evidence_span: '원문 발췌',
    health_observation: '건강 측정',
    medication_assertion: '복용 정보',
    medication_definition: '약 정보',
    source_record: '저장된 출처',
    symptom_entry: '증상 기록',
    transcript_segment: '녹음 전사',
    visit_brief: '진료 요약',
    visit_question: '진료 질문',
  };
  return labels[entry.kind] ?? entry.kind;
}

function memoryRows(record: PersistedMemoryRecord): EvidenceSourceDetailRow[] {
  const meta = record.meta as Record<string, unknown>;
  const provenance = meta.provenance as Record<string, unknown>;
  const sourceDates = Array.isArray(provenance.sourceDates)
    ? provenance.sourceDates
        .map(item => {
          if (!item || typeof item !== 'object') return undefined;
          const date = (item as Record<string, unknown>).date;
          return typeof date === 'string' ? date : undefined;
        })
        .filter((date): date is string => date !== undefined)
    : [];
  return [
    { label: '저장된 내용', value: record.text },
    ...(sourceDates.length
      ? [{ label: '출처 날짜', value: sourceDates.join(', ') }]
      : []),
  ];
}

/** Renders persisted citation sources without exposing opaque local identifiers. */
export function presentEvidenceSource(
  document: EvidenceSourceDocument,
): readonly EvidenceSourceDetailSection[] {
  if (document.sourceKind === 'health_context_period')
    return presentHealthContext(document.scope, document.report);
  if (document.sourceKind === 'reviewed_memory') {
    return [
      {
        title: '검토된 기억',
        rows: memoryRows(document.record),
        hero: { body: document.record.text, consumedLabels: ['저장된 내용'] },
      },
    ];
  }
  return document.records.map(entry => ({
    title: recordTitle(entry),
    rows: personalRecordRows(entry),
    hero: evidenceRecordHero(entry),
  }));
}
