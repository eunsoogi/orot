import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { HealthObservation } from '@orot/domain';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { formatRecordedAt } from '../recording/formatRecordedAt';
import type { HealthRecordsDetailRow } from './healthRecordsDetailModel';
import {
  displayedQuantity,
  displayRecordValue,
  hasUnavailableSourceValue,
  provenanceLabel,
} from './healthRecordsDetailPresentation';
import {
  classifyHealthObservation,
  healthRecordCategoryTitle,
} from './healthRecordsLibraryModel';

const PRESSURE_ROW_MINIMUM_WIDTH = 360;

/** Keeps paired pressure components together and labels unavailable source details. */
export function HealthRecordsDetailRecordRow({
  index,
  row,
}: {
  readonly index: number;
  readonly row: HealthRecordsDetailRow;
}) {
  const { width, fontScale } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  // Three date/value columns need a minimum width; the window can be wider than a Duo panel.
  const compact =
    fontScale > 1.3 ||
    (measuredWidth ?? Math.max(0, width - 40)) < PRESSURE_ROW_MINIMUM_WIDTH;
  if (row.kind === 'blood_pressure') {
    const { systolic, diastolic } = row.reading;
    const present = [systolic, diastolic].filter(Boolean);
    return (
      <View
        onLayout={event => {
          const nextWidth = event.nativeEvent.layout.width;
          setMeasuredWidth(previous =>
            previous === nextWidth ? previous : nextWidth,
          );
        }}
        style={styles.record}
        testID={'health-record-row-' + index}
      >
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
          {systolic ? (
            <ValueLine compact={compact} index={index} observation={systolic} />
          ) : null}
          {diastolic ? (
            <ValueLine
              compact={compact}
              index={index}
              observation={diastolic}
            />
          ) : null}
        </View>
      </View>
    );
  }
  const category = classifyHealthObservation(row.observation);
  const sourceValueUnavailable = hasUnavailableSourceValue(row.observation);
  return (
    <View style={styles.record} testID={'health-record-row-' + index}>
      <Text
        style={styles.concept}
        testID={'health-record-row-' + index + '-concept'}
      >
        {healthRecordCategoryTitle(category)}
      </Text>
      <Text
        style={styles.detailValue}
        testID={'health-record-row-' + index + '-value'}
      >
        {displayRecordValue(row.observation)}
      </Text>
      <Text style={styles.date} testID={'health-record-row-' + index + '-time'}>
        {formatRecordedAt(row.observation.effectiveAt)}
      </Text>
      <Text
        style={styles.source}
        testID={'health-record-row-' + index + '-source'}
      >
        {provenanceLabel(row.observation)}
      </Text>
      {sourceValueUnavailable ? (
        <Text
          style={styles.sourceNote}
          testID={'health-record-row-' + index + '-source-value'}
        >
          {t('healthRecords.sourceValueUnavailable')}
        </Text>
      ) : null}
    </View>
  );
}

function ValueLine({
  compact,
  index,
  observation,
}: {
  readonly compact: boolean;
  readonly index: number;
  readonly observation: HealthObservation;
}) {
  const systolic = observation.concept.endsWith('systolic');
  const label = systolic
    ? t('healthkit.bloodPressure.component.systolic')
    : t('healthkit.bloodPressure.component.diastolic');
  const quantity = displayedQuantity(observation);
  const value = quantity
    ? quantity.amount + ' ' + quantity.unit
    : displayRecordValue(observation);
  const valueTestID =
    'health-record-row-' + index + (systolic ? '-systolic' : '-diastolic');
  const sourceValueUnavailable = hasUnavailableSourceValue(observation);

  return (
    <View
      style={[styles.pressureValue, compact && styles.compactPressureValue]}
    >
      <View
        accessible
        accessibilityLabel={label + ' ' + value}
        style={styles.pressureValueCopy}
        testID={valueTestID}
      >
        <Text style={styles.date}>{label}</Text>
        <Text style={styles.amount}>
          {quantity ? quantity.amount : value}
          {quantity ? (
            <Text style={styles.unit}>{' ' + quantity.unit}</Text>
          ) : null}
        </Text>
      </View>
      <Text style={styles.source} testID={valueTestID + '-source'}>
        {provenanceLabel(observation)}
      </Text>
      {sourceValueUnavailable ? (
        <Text style={styles.sourceNote} testID={valueTestID + '-source-value'}>
          {t('healthRecords.sourceValueUnavailable')}
        </Text>
      ) : null}
    </View>
  );
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
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: appColors.border,
    paddingLeft: 12,
  },
  compactPressureValue: {
    borderLeftWidth: 0,
    borderTopColor: appColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingLeft: 0,
    paddingTop: 12,
  },
  pressureValueCopy: { gap: 6 },
  amount: { color: appColors.text, fontSize: 26, fontWeight: '700' },
  unit: { color: appColors.secondary, fontSize: 12, fontWeight: '500' },
  detailValue: { color: appColors.text, fontSize: 18, fontWeight: '600' },
  concept: { color: appColors.text, fontSize: 16, fontWeight: '700' },
  date: { color: appColors.secondary, fontSize: 13 },
  source: { color: appColors.secondary, fontSize: 12, marginTop: 6 },
  sourceNote: { color: appColors.secondary, fontSize: 12, marginTop: 4 },
  partial: { color: appColors.secondary, fontSize: 12 },
});
