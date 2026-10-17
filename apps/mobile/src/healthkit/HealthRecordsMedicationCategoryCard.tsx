import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { formatRecordedAt } from '../recording/formatRecordedAt';
import type { HealthRecordsDetailSelection } from './healthRecordsLibraryModel';
import { healthRecordCategoryTitle } from './healthRecordsLibraryModel';
import type { HealthRecordsMedicationData } from './healthRecordsMedicationLibrary';
import {
  emptyHealthRecordsMedicationData,
  loadEmptyHealthRecordsMedicationData,
} from './healthRecordsMedicationLibrary';

interface HealthRecordsMedicationCategoryCardProps {
  readonly loadMedicationData?: () => Promise<HealthRecordsMedicationData>;
  readonly onOpenDetail: (selection: HealthRecordsDetailSelection) => void;
}

/** Shows stored medication events as a summary instead of a numeric chart. */
export function HealthRecordsMedicationCategoryCard({
  loadMedicationData = loadEmptyHealthRecordsMedicationData,
  onOpenDetail,
}: HealthRecordsMedicationCategoryCardProps) {
  const [data, setData] = useState(emptyHealthRecordsMedicationData);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(
    'loading',
  );
  const generation = useRef(0);
  const title = healthRecordCategoryTitle('medications');
  const latestDose = [...data.doseEvents].sort((left, right) =>
    right.effectiveAt.localeCompare(left.effectiveAt),
  )[0];

  const reload = useCallback(async () => {
    const request = ++generation.current;
    setStatus('loading');
    try {
      const next = await loadMedicationData();
      if (request !== generation.current) return;
      setData(next);
      setStatus('ready');
    } catch {
      if (request === generation.current) setStatus('failed');
    }
  }, [loadMedicationData]);

  useEffect(() => {
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  const message =
    status === 'loading'
      ? t('healthRecords.loading')
      : status === 'failed'
        ? t('healthRecords.error')
        : data.definitions.length === 0 && data.doseEvents.length === 0
          ? t('healthRecords.categoryEmpty', { title })
          : latestDose
            ? t('healthRecords.medicationLatestDose', {
                timestamp: formatRecordedAt(latestDose.effectiveAt),
              })
            : t('healthRecords.medicationNoDoseEvents');

  return (
    <View style={styles.card} testID="health-record-category-medications">
      <View style={styles.heading}>
        <View style={styles.icon}>
          <AppSymbol
            name="pills.fill"
            size={26}
            color={appColors.primaryAction}
          />
        </View>
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={styles.title}>
            {title + ' 기록'}
          </Text>
          <Text style={styles.summary} testID="health-record-medications-count">
            {t('healthRecords.medicationCountSummary', {
              medications: data.definitions.length,
              doseEvents: data.doseEvents.length,
            })}
          </Text>
        </View>
        <AppButton
          accessibilityHint={t('healthRecords.detailHint', { title })}
          onPress={() =>
            onOpenDetail({ category: 'medications', period: 'month' })
          }
          testID="health-record-open-detail-medications"
          title={t('healthRecords.detail')}
          variant="secondary"
        />
      </View>
      <Text
        accessibilityRole={status === 'failed' ? 'alert' : undefined}
        style={status === 'failed' ? styles.error : styles.message}
        testID="health-record-medications-summary"
      >
        {message}
      </Text>
      {status === 'failed' ? (
        <AppButton
          onPress={() => void reload()}
          testID="health-record-medications-retry"
          title={t('healthRecords.retry')}
          variant="secondary"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 14,
    padding: 16,
  },
  heading: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  icon: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  copy: { flex: 1, gap: 4 },
  title: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  summary: { color: appColors.secondary, fontSize: 13 },
  message: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
  error: { color: appColors.danger, fontSize: 14, lineHeight: 20 },
});
