import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import type { DailyReportSourceRecord } from '@orot/domain';
import { compareTimestamps } from '@orot/domain';
import { stableJson } from './evidenceUtils';
import { t } from '../../i18n';
import { visibleValue } from './evidenceSourceValues';

/** Keep differing same-instant measurements together, without deciding which source is correct. */
export function conflictingDailyReportIndexes(
  values: readonly LocalHealthEvidenceRecord[],
) {
  return comparedDailyReportIndexes(values, false);
}

/** Distinct units at the same instant are incomparable without an explicit conversion. */
export function incomparableDailyReportIndexes(
  values: readonly LocalHealthEvidenceRecord[],
) {
  return comparedDailyReportIndexes(values, true);
}

function comparedDailyReportIndexes(
  values: readonly LocalHealthEvidenceRecord[],
  incomparable: boolean,
) {
  const groups = new Map<
    string,
    { index: number; value: string; at: string; unit: string }[]
  >();
  values.forEach((item, index) => {
    if (
      item.kind !== 'health_observation' ||
      item.record.observationKind !== 'measurement'
    )
      return;
    const concept = item.record.concept.toLowerCase();
    // These exact aliases already identify the same axis in the pressure reader
    // and HealthKit importer. Normalize comparison only, never stored values,
    // source identity, units, timestamps or systolic versus diastolic axes.
    const key =
      concept === 'blood pressure systolic'
        ? 'blood_pressure_systolic'
        : concept === 'blood pressure diastolic'
          ? 'blood_pressure_diastolic'
          : concept;
    const group = groups.get(key) ?? [];
    group.push({
      index,
      value: stableJson(item.record.value),
      at: item.record.effectiveAt,
      unit:
        item.record.value.kind === 'quantity'
          ? item.record.value.unit
          : item.record.value.kind,
    });
    groups.set(key, group);
  });
  return [...groups.values()].flatMap(group =>
    group
      .filter(item =>
        group.some(
          other =>
            compareTimestamps(item.at, other.at) === 0 &&
            (incomparable
              ? item.unit !== other.unit
              : item.unit === other.unit && item.value !== other.value),
        ),
      )
      .map(item => item.index),
  );
}

/** Render only stored fields; the model may select facts but cannot author medical claims. */
export function dailyReportFacts(
  values: readonly LocalHealthEvidenceRecord[],
  sources: readonly DailyReportSourceRecord[],
) {
  if (values.length !== sources.length)
    throw new Error('Snapshot sources do not match values.');
  return values.map((item, index) => {
    const source = sources[index]!;
    if (item.kind !== source.source || item.record.id !== source.recordId)
      throw new Error('Snapshot source mismatch.');
    const record = item.record;
    let detail: string;
    let displayDetail: string;
    if (item.kind === 'health_observation') {
      const value = item.record.value;
      const rendered =
        value.kind === 'quantity'
          ? `${value.amount} ${value.unit}`
          : value.kind === 'text'
            ? value.text
            : String(value.value);
      detail = `${item.record.concept}: ${rendered}`;
      const unit =
        value.kind === 'quantity'
          ? item.record.concept === 'step_count' && value.unit === 'count'
            ? '걸음'
            : value.unit === 'count/min'
              ? '회/분'
              : value.unit
          : '';
      displayDetail = `${visibleValue(item.record.concept, 'concept')}: ${value.kind === 'quantity' ? `${value.amount.toLocaleString('ko-KR')} ${unit}` : rendered}`;
    } else if (item.kind === 'symptom_entry') {
      detail = `증상: ${item.record.description}${item.record.severity === undefined ? '' : ` (정도 ${item.record.severity}/10)`}, 상태: ${item.record.status}`;
      displayDetail = t('dailyReport.symptom', {
        description: item.record.description,
        severity:
          item.record.severity === undefined
            ? ''
            : t('dailyReport.severity', { severity: item.record.severity }),
        status: item.record.status,
      });
    } else if (item.kind === 'dose_event') {
      detail = `복약 기록: ${item.record.eventKind}${item.record.eventKind === 'observed' ? `, 상태: ${item.record.observationStatus}` : ''}${item.record.dose ? `, 용량: ${item.record.dose.amount ?? ''} ${item.record.dose.unit}` : ''}`;
      displayDetail = t('dailyReport.dose', {
        kind:
          visibleValue(item.record.eventKind, 'eventKind') ??
          item.record.eventKind,
        status:
          item.record.eventKind === 'observed'
            ? t('dailyReport.doseStatus', {
                status:
                  visibleValue(
                    item.record.observationStatus,
                    'observationStatus',
                  ) ?? item.record.observationStatus,
              })
            : '',
        dose: item.record.dose
          ? t('dailyReport.doseAmount', {
              amount: item.record.dose.amount ?? '',
              unit: item.record.dose.unit,
            })
          : '',
      });
    } else if (
      item.kind === 'medication_definition' ||
      item.kind === 'medication_assertion'
    ) {
      const name =
        item.kind === 'medication_definition'
          ? item.record.displayText
          : item.record.medicationName;
      detail = `Linked medication identity: ${name}; dose completion is determined by the linked dose event, not by registration alone.`;
      displayDetail = t('dailyReport.medication.identity', { name });
    } else if (item.kind === 'appointment') {
      detail = `Appointment status: ${item.record.status}`;
      displayDetail = t('dailyReport.context.appointmentFact', {
        status: t(`dailyReport.context.appointment.${item.record.status}`),
      });
    } else throw new Error('Unsupported daily report record.');
    const medicationIndex =
      item.kind === 'dose_event'
        ? values.findIndex(candidate =>
            item.record.eventKind === 'observed'
              ? candidate.kind === 'medication_definition' &&
                candidate.record.id === item.record.medicationDefinitionId
              : candidate.kind === 'medication_assertion' &&
                candidate.record.id === item.record.medicationAssertionId,
          )
        : -1;
    const medication = values[medicationIndex];
    if (
      medication?.kind === 'medication_definition' ||
      medication?.kind === 'medication_assertion'
    ) {
      const name =
        medication.kind === 'medication_definition'
          ? medication.record.displayText
          : medication.record.medicationName;
      detail = `${name}: ${detail}`;
      displayDetail = `${name}: ${displayDetail}`;
    }
    const references: Pick<DailyReportSourceRecord, 'source' | 'recordId'>[] = [
      { source: source.source, recordId: source.recordId },
    ];
    if (medicationIndex >= 0)
      references.push({
        source: sources[medicationIndex]!.source,
        recordId: sources[medicationIndex]!.recordId,
      });
    const provenance = record.provenance.source;
    const sourceName =
      provenance?.sourceName ?? provenance?.system ?? record.provenance.origin;
    const time = source.occurrence.endExclusive
      ? `${source.occurrence.startInclusive}–${source.occurrence.endExclusive}`
      : source.occurrence.startInclusive;
    return {
      text: t('dailyReport.fact', {
        detail: displayDetail,
        time: source.occurrence.endExclusive
          ? `${visibleValue(source.occurrence.startInclusive, 'effectiveAt')}–${visibleValue(source.occurrence.endExclusive, 'endedAt')}`
          : visibleValue(source.occurrence.startInclusive, 'effectiveAt')!,
        source: sourceName,
        origin: visibleValue(record.provenance.origin, 'origin')!,
      }),
      modelText: `${detail} · 시각: ${time} · 기록 출처 유형: ${record.provenance.origin}`,
      sourceReferences: references,
    };
  });
}
