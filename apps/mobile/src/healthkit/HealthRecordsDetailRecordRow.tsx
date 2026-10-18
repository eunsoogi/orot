import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { HealthObservation } from '@orot/domain';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { formatRecordedAt } from '../recording/formatRecordedAt';
import type { HealthRecordsDetailRow } from './healthRecordsDetailModel';
import {
  classifyHealthObservation,
  healthRecordCategoryTitle,
} from './healthRecordsLibraryModel';

/** Keeps paired pressure components together and leaves missing values absent. */
export function HealthRecordsDetailRecordRow({
  index,
  row,
}: {
  readonly index: number;
  readonly row: HealthRecordsDetailRow;
}) {
  const { width, fontScale } = useWindowDimensions();
  const compact = width < 350 || fontScale > 1.3;
  if (row.kind === 'blood_pressure') {
    const { systolic, diastolic } = row.reading;
    const present = [systolic, diastolic].filter(Boolean);
    return (
      <View style={styles.record} testID={'health-record-row-' + index}>
        {present.length === 1 ? (
          <Text style={styles.partial}>
            {t('healthRecords.incompleteBloodPressure')}
          </Text>
        ) : null}
        <View
          style={[styles.pressureColumns, compact && styles.compactColumns]}
          testID={'health-record-row-' + index + '-columns'}
        >
          <View
            style={[styles.dateColumn, compact && styles.compactDate]}
            accessible
            accessibilityLabel={formatRecordedAt(row.reading.effectiveAt)}
            testID={'health-record-row-' + index + '-time'}
          >
            <Text style={styles.dateTitle}>
              {new Date(row.reading.effectiveAt).toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
              })}
            </Text>
            <Text style={styles.date}>
              {new Date(row.reading.effectiveAt).toLocaleTimeString('ko-KR', {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Text>
          </View>
          {systolic ? <ValueLine index={index} observation={systolic} /> : null}
          {diastolic ? (
            <ValueLine index={index} observation={diastolic} />
          ) : null}
        </View>
      </View>
    );
  }
  const category = classifyHealthObservation(row.observation);
  return (
    <View style={styles.record} testID={'health-record-row-' + index}>
      <Text
        style={styles.concept}
        testID={'health-record-row-' + index + '-concept'}
      >
        {healthRecordCategoryTitle(category)}
      </Text>
      <Text testID={'health-record-row-' + index + '-value'}>
        {displayValue(row.observation)}
      </Text>
      <Text style={styles.date} testID={'health-record-row-' + index + '-time'}>
        {formatRecordedAt(row.observation.effectiveAt)}
      </Text>
    </View>
  );
}

function ValueLine({
  index,
  observation,
}: {
  readonly index: number;
  readonly observation: HealthObservation;
}) {
  const systolic = observation.concept.endsWith('systolic');
  const label = systolic
    ? t('healthkit.bloodPressure.component.systolic')
    : t('healthkit.bloodPressure.component.diastolic');
  return (
    <View
      accessible
      accessibilityLabel={label + ' ' + displayValue(observation)}
      style={styles.pressureValue}
      testID={
        'health-record-row-' + index + (systolic ? '-systolic' : '-diastolic')
      }
    >
      <Text style={styles.date}>{label}</Text>
      <Text style={styles.amount}>
        {observation.value.kind === 'quantity'
          ? observation.value.amount
          : displayValue(observation)}
        <Text style={styles.unit}>
          {observation.value.kind === 'quantity'
            ? ' ' + observation.value.unit
            : ''}
        </Text>
      </Text>
    </View>
  );
}

function displayValue(observation: HealthObservation): string {
  switch (observation.value.kind) {
    case 'quantity':
      return observation.value.amount + ' ' + observation.value.unit;
    case 'text':
      return observation.value.text;
    case 'boolean':
      return observation.value.value
        ? t('healthRecords.yes')
        : t('healthRecords.no');
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
  pressureColumns: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // A single column gives enlarged numbers and their units the full card width.
  compactColumns: { flexDirection: 'column', alignItems: 'stretch' },
  dateColumn: { flex: 1.3, gap: 6 },
  compactDate: { flex: 0 },
  dateTitle: { color: appColors.text, fontSize: 14, fontWeight: '700' },
  pressureValue: {
    flex: 1,
    gap: 6,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: appColors.border,
    paddingLeft: 12,
  },
  amount: { color: appColors.text, fontSize: 26, fontWeight: '700' },
  unit: { color: appColors.secondary, fontSize: 12, fontWeight: '500' },
  concept: { color: appColors.text, fontSize: 16, fontWeight: '700' },
  date: { color: appColors.secondary, fontSize: 13 },
  partial: { color: appColors.secondary, fontSize: 12 },
});
