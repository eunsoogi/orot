import { StyleSheet, View } from 'react-native';
import type { DoseObservationStatus } from '@orot/domain';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { formatRecordedAt } from '../recording/formatRecordedAt';
import type { HealthRecordsMedicationDetailRow } from './healthRecordsMedicationDetailModel';

/** Renders the exact imported dose status without inferring a missed or taken dose. */
export function HealthRecordsMedicationRecordRow({
  index,
  row,
}: {
  readonly index: number;
  readonly row: HealthRecordsMedicationDetailRow;
}) {
  const dose = row.doseEvent.dose;
  return (
    <View
      style={styles.record}
      testID={'health-record-medication-row-' + index}
    >
      <Text style={styles.title}>
        {row.medicationName ?? t('healthRecords.medicationUnknownName')}
      </Text>
      <Text testID={'health-record-medication-row-' + index + '-status'}>
        {statusLabel(row.doseEvent.observationStatus)}
      </Text>
      <Text testID={'health-record-medication-row-' + index + '-dose'}>
        {dose?.amount === undefined
          ? t('healthRecords.medicationDoseNotRecorded')
          : t('healthRecords.medicationDose', {
              amount: dose.amount,
              unit: dose.unit,
            })}
      </Text>
      <Text
        style={styles.date}
        testID={'health-record-medication-row-' + index + '-time'}
      >
        {formatRecordedAt(row.doseEvent.effectiveAt)}
      </Text>
      <Text
        style={styles.date}
        testID={'health-record-medication-row-' + index + '-source'}
      >
        {t('healthRecords.medicationSource', { source: sourceLabel(row) })}
      </Text>
    </View>
  );
}

function sourceLabel(row: HealthRecordsMedicationDetailRow): string {
  const source = row.doseEvent.provenance.source;
  // Source identifiers are import keys, so display only a readable name or the known system label.
  if (source?.sourceName) return source.sourceName;
  if (source?.system === 'healthkit') return 'HealthKit';
  return t('healthRecords.medicationSourceUnavailable');
}

function statusLabel(status: DoseObservationStatus): string {
  switch (status) {
    case 'not_interacted':
      return t('healthRecords.medicationStatus.not_interacted');
    case 'notification_not_sent':
      return t('healthRecords.medicationStatus.notification_not_sent');
    case 'snoozed':
      return t('healthRecords.medicationStatus.snoozed');
    case 'taken':
      return t('healthRecords.medicationStatus.taken');
    case 'skipped':
      return t('healthRecords.medicationStatus.skipped');
    case 'not_logged':
      return t('healthRecords.medicationStatus.not_logged');
    case 'unknown':
      return t('healthRecords.medicationStatus.unknown');
  }
}

const styles = StyleSheet.create({
  record: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  title: { color: appColors.text, fontSize: 16, fontWeight: '700' },
  date: { color: appColors.secondary, fontSize: 13 },
});
