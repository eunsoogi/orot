import { t } from '../../i18n';
import {
  fieldLabels,
  visibleValue,
  isPrivateIdentifier,
} from './evidenceSourceValues';
import type { PersistedMemoryRecord } from '@orot/agent-memory';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceRepository';
import type { EvidenceSourceDocument } from './evidenceRegistry';
import { manualHistoryPresentation } from './manualHistorySourcePresentation';
import { presentHealthContextDocument } from './healthContextPresentation';
import { presentResearchSource } from './researchSourcePresentation';
import { evidenceSourceManagementFields } from './evidenceSourceManagementFields';
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

function personalRecordRows(
  entry: LocalHealthEvidenceRecord,
): EvidenceSourceDetailRow[] {
  const record = entry.record as unknown as Record<string, unknown>;
  const rows: EvidenceSourceDetailRow[] = [];
  for (const [key, value] of Object.entries(record)) {
    // Imported event kind describes ingestion, while observationStatus is the actual dose outcome.
    if (
      entry.kind === 'dose_event' &&
      key === 'eventKind' &&
      value === 'observed'
    )
      continue;
    if (
      !fieldLabels[key] ||
      isPrivateIdentifier(key) ||
      evidenceSourceManagementFields.has(key)
    )
      continue;
    const rendered = visibleValue(value, key);
    if (rendered)
      rows.push({
        label:
          entry.kind === 'dose_event' &&
          (key === 'eventKind' || key === 'observationStatus')
            ? t('evidenceSource.doseStatus')
            : (fieldLabels[key] ?? key),
        value: rendered,
      });
  }
  const provenance = record.provenance as
    { origin?: unknown; source?: Record<string, unknown> } | undefined;
  const source = provenance?.source;
  if (source) {
    const rendered =
      visibleValue(source.sourceName) ?? visibleValue(source.system, 'system');
    if (rendered)
      rows.push({ label: t('evidenceSource.source'), value: rendered });
  }
  return rows;
}

function recordTitle(entry: LocalHealthEvidenceRecord): string {
  const labels: Partial<Record<LocalHealthEvidenceRecord['kind'], string>> = {
    appointment: t('evidenceSource.appointment'),
    dose_event: t('evidenceSource.dose'),
    encounter: t('evidenceSource.encounter'),
    evidence_span: t('evidenceSource.excerpt'),
    health_observation: t('evidenceSource.observation'),
    medication_assertion: t('evidenceSource.medicationAssertion'),
    medication_definition: t('evidenceSource.medicationDefinition'),
    source_record: t('evidenceSource.sourceRecord'),
    symptom_entry: t('evidenceSource.symptom'),
    transcript_segment: t('evidenceSource.transcript'),
    visit_brief: t('evidenceSource.visitBrief'),
    visit_question: t('evidenceSource.visitQuestion'),
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
    { label: t('evidenceSource.savedContent'), value: record.text },
    ...(sourceDates.length
      ? [
          {
            label: t('evidenceSource.sourceDates'),
            value: sourceDates.join(', '),
          },
        ]
      : []),
  ];
}

/** Renders persisted citation sources without exposing opaque local identifiers. */
export function presentEvidenceSource(
  document: EvidenceSourceDocument,
): readonly EvidenceSourceDetailSection[] {
  if (document.sourceKind === 'health_context_period')
    return presentHealthContextDocument(document);
  if (document.sourceKind === 'reviewed_memory') {
    return [
      {
        title: t('evidenceSource.reviewedMemory'),
        rows: memoryRows(document.record),
        hero: {
          body: document.record.text,
          consumedLabels: [t('evidenceSource.savedContent')],
        },
      },
    ];
  }
  if (document.sourceKind === 'manual_history')
    return manualHistoryPresentation(document.evidence);
  if (document.sourceKind === 'generated_artifact' && 'research' in document)
    return presentResearchSource(document.research);
  if (
    document.sourceKind === 'generated_artifact' &&
    'conversation' in document
  )
    return [
      {
        title: t('evidenceSource.priorConversation'),
        rows: [
          {
            label: t('evidenceSource.generatedAt'),
            value: document.metadata.createdAt,
          },
          {
            label: t('evidenceSource.sourceStatus'),
            value:
              document.sourceStatus === 'current'
                ? t('evidenceSource.currentSource')
                : t('evidenceSource.unavailableSource'),
          },
          {
            label: t('evidenceSource.caution'),
            value: t('evidenceSource.priorAnswerNotice'),
          },
          {
            label: t('evidenceSource.question'),
            value: document.conversation.question,
          },
        ],
        hero: { body: document.conversation.answer, consumedLabels: [] },
      },
    ];
  if (document.sourceKind === 'generated_artifact')
    return document.analysis.hypotheses.map(section => ({
      title: t('evidenceSource.priorResult'),
      rows: [
        {
          label: t('evidenceSource.generatedAt'),
          value: document.metadata.createdAt,
        },
        {
          label: t('evidenceSource.sourceStatus'),
          value:
            document.sourceStatus === 'current'
              ? t('evidenceSource.currentSource')
              : document.sourceStatus === 'changed'
                ? t('evidenceSource.changedSource')
                : t('evidenceSource.unavailableSource'),
        },
        {
          label: t('evidenceSource.caution'),
          value: t('evidenceSource.priorResultNotice'),
        },
        ...(section.uncertainty
          ? [
              {
                label: t('evidenceSource.uncertainty'),
                value: section.uncertainty,
              },
            ]
          : []),
      ],
      hero: {
        heading: section.title,
        body: section.summary,
        consumedLabels: [],
      },
    }));
  if (document.sourceKind === 'conversation_photo')
    return [
      {
        title: t('evidenceSource.photoText'),
        rows: [],
        hero: { body: document.section.text, consumedLabels: [] },
      },
    ];
  return document.records.map(entry => ({
    title: recordTitle(entry),
    rows: personalRecordRows(entry),
    hero: evidenceRecordHero(entry, document.records),
  }));
}
