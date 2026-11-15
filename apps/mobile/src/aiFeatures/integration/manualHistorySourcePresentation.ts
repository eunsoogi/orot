import type { ManualHistoryEvidence } from '@orot/domain';
import type { EvidenceSourceDetailSection } from './evidenceSourcePresentation';
import { t } from '../../i18n';

/** Display saved history and its explicit review status without clinical reinterpretation. */
export function manualHistoryPresentation(
  evidence: ManualHistoryEvidence,
): EvidenceSourceDetailSection[] {
  const kindLabels: Record<ManualHistoryEvidence['kind'], string> = {
    diagnosis_history: t('evidenceSource.diagnosisHistory'),
    procedure: t('evidenceSource.procedure'),
    medication_context: t('evidenceSource.medicationContext'),
    note: t('evidenceSource.note'),
  };
  return [
    {
      title: t('evidenceSource.manualHistory'),
      rows: [
        {
          label: t('evidenceSource.recordKind'),
          value: kindLabels[evidence.kind],
        },
        {
          label: t('evidenceSource.effectiveDate'),
          value:
            evidence.effectiveDate.status === 'known'
              ? evidence.effectiveDate.date
              : t('evidenceSource.unknown'),
        },
        {
          label: t('evidenceSource.source'),
          value: t('evidenceSource.userReported'),
        },
        {
          label: t('evidenceSource.reviewState'),
          value:
            evidence.reviewState.status === 'reviewed'
              ? t('evidenceSource.confirmed')
              : t('evidenceSource.notClinicianConfirmed'),
        },
        { label: t('evidenceSource.recordedDate'), value: evidence.recordedAt },
        ...(evidence.correctionNote
          ? [
              {
                label: t('evidenceSource.correctionNote'),
                value: evidence.correctionNote,
              },
            ]
          : []),
      ],
      hero: {
        heading: kindLabels[evidence.kind],
        body: evidence.text,
        consumedLabels: [],
      },
    },
  ];
}
