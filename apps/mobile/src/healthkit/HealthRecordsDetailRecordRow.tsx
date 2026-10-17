import { StyleSheet, View } from 'react-native';
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
        {systolic ? <ValueLine index={index} observation={systolic} /> : null}
        {diastolic ? <ValueLine index={index} observation={diastolic} /> : null}
        <Text
          style={styles.date}
          testID={'health-record-row-' + index + '-time'}
        >
          {formatRecordedAt(row.reading.effectiveAt)}
        </Text>
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
    <Text
      testID={
        'health-record-row-' + index + (systolic ? '-systolic' : '-diastolic')
      }
    >
      {label + ' ' + displayValue(observation)}
    </Text>
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
  concept: { color: appColors.text, fontSize: 16, fontWeight: '700' },
  date: { color: appColors.secondary, fontSize: 13 },
  partial: { color: appColors.secondary, fontSize: 12 },
});
