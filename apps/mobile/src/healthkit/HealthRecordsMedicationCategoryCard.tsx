import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { formatDate, t } from '../i18n';
import {
  healthRecordCategoryTitle,
  type HealthRecordsDetailSelection,
} from './healthRecordsLibraryModel';
import type { useHealthRecordsMedicationSummary } from './useHealthRecordsMedicationSummary';
import { HealthRecordsCategoryHeading } from './HealthRecordsCategoryHeading';

type Props = {
  readonly summary: ReturnType<typeof useHealthRecordsMedicationSummary>;
  readonly onOpenDetail: (selection: HealthRecordsDetailSelection) => void;
};

const visibleMedicationCount = 5;

/** Counts source-confirmed dose records, never dose amounts or adherence. */
export function HealthRecordsMedicationCategoryCard({
  summary,
  onOpenDetail,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const { data, status, reload } = summary;
  const title = healthRecordCategoryTitle('medications');
  const month = data.monthlyTaken;
  const ready =
    status === 'ready' && month?.status === 'complete' ? month : undefined;
  const date = (stamp: string) =>
    formatDate(new Date(stamp), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  const period =
    month &&
    t('healthRecords.medicationMonthPeriod', {
      from: date(month.fromInclusive),
      to: date(month.toInclusive),
    });
  const message =
    status === 'loading'
      ? t('healthRecords.loading')
      : status === 'failed'
        ? t('healthRecords.error')
        : !ready
          ? t('healthRecords.medicationMonthUnverified')
          : ready.takenCount === 0
            ? t('healthRecords.medicationMonthNoTaken')
            : t('healthRecords.medicationSource', {
                source: t('healthRecords.source.healthApp'),
              });
  const medications = ready?.medications ?? [];
  const shown = expanded
    ? medications
    : medications.slice(0, visibleMedicationCount);

  return (
    <View style={styles.card} testID="health-record-category-medications">
      <HealthRecordsCategoryHeading
        icon={
          <View style={styles.icon}>
            <AppSymbol name="pills.fill" color={appColors.primaryAction} />
          </View>
        }
        action={
          <AppButton
            accessibilityHint={t('healthRecords.detailHint', { title })}
            onPress={() =>
              onOpenDetail({ category: 'medications', period: 'month' })
            }
            testID="health-record-open-detail-medications"
            title={t('healthRecords.detail')}
            variant="secondary"
          />
        }
        body={
          <View style={styles.body}>
            <Text
              accessibilityRole={status === 'failed' ? 'alert' : undefined}
              style={status === 'failed' ? styles.error : styles.secondary}
              testID="health-record-medications-summary"
            >
              {message}
            </Text>
            {shown.length ? (
              <View
                style={styles.list}
                testID="health-record-medication-month-list"
              >
                {shown.map(medication => (
                  <View
                    key={medication.medicationId}
                    accessible
                    accessibilityLabel={t(
                      'healthRecords.medicationMonthRowLabel',
                      { name: medication.name, count: medication.count },
                    )}
                    style={styles.row}
                  >
                    <Text style={styles.name}>{medication.name}</Text>
                    <Text style={styles.count}>
                      {t('healthRecords.medicationMonthRowCount', {
                        count: medication.count,
                      })}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            {medications.length > visibleMedicationCount ? (
              <AppButton
                onPress={() => setExpanded(current => !current)}
                testID="health-record-medication-month-toggle"
                title={
                  expanded
                    ? t('healthRecords.medicationMonthCollapse')
                    : t('healthRecords.medicationMonthExpand', {
                        count: medications.length,
                      })
                }
                variant="secondary"
              />
            ) : null}
            {ready && ready.unverifiedCount > 0 ? (
              <Text style={styles.secondary}>
                {t('healthRecords.medicationMonthExcluded', {
                  count: ready.unverifiedCount,
                })}
              </Text>
            ) : null}
            {status === 'failed' ? (
              <AppButton
                onPress={() => {
                  reload();
                }}
                testID="health-record-medications-retry"
                title={t('healthRecords.retry')}
                variant="secondary"
              />
            ) : null}
          </View>
        }
      >
        <Text accessibilityRole="header" style={styles.title}>
          {t('legacySymptom.categoryRecords', { category: title })}
        </Text>
        {period ? (
          <Text
            style={styles.secondary}
            testID="health-record-medication-month-period"
          >
            {period}
          </Text>
        ) : null}
        {ready ? (
          <Text style={styles.taken} testID="health-record-medications-count">
            {t('healthRecords.medicationMonthTaken', {
              count: ready.takenCount,
            })}
          </Text>
        ) : null}
      </HealthRecordsCategoryHeading>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: appColors.surface,
    borderRadius: 18,
    borderWidth: 0,
    gap: 14,
    padding: 16,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  body: { gap: 12 },
  list: { gap: 6 },
  row: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 10,
    columnGap: 12,
    flexDirection: 'row',
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  name: { color: appColors.text, flex: 1, fontSize: 15, minWidth: 0 },
  count: { color: appColors.text, fontSize: 15, fontWeight: '700' },
  title: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  taken: { color: appColors.text, fontSize: 19, fontWeight: '700' },
  secondary: { color: appColors.secondary, fontSize: 13, lineHeight: 19 },
  error: { color: appColors.danger, fontSize: 14, lineHeight: 20 },
});
