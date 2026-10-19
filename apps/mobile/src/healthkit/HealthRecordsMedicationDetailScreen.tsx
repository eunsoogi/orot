import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { navigationText } from '../i18n/navigation';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { NavigationLeaveState } from '../navigation';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import type { HealthRecordsDetailSelection } from './healthRecordsLibraryModel';
import {
  healthRecordCategoryTitle,
  healthRecordPeriodTitle,
} from './healthRecordsLibraryModel';
import { buildHealthRecordsMedicationDetailRows } from './healthRecordsMedicationDetailModel';
import { healthRecordPeriods } from './healthRecordsDetailModel';
import { HealthRecordsMedicationRecordRow } from './HealthRecordsMedicationRecordRow';
import { healthRecordsDetailStyles as styles } from './HealthRecordsDetailScreen.styles';
import type { HealthRecordsMedicationData } from './healthRecordsMedicationLibrary';
import {
  emptyHealthRecordsMedicationData,
  loadEmptyHealthRecordsMedicationData,
} from './healthRecordsMedicationLibrary';

interface HealthRecordsMedicationDetailScreenProps {
  readonly loadMedicationData?: () => Promise<HealthRecordsMedicationData>;
  readonly onBack: () => void;
  readonly onSelectionChange: (selection: HealthRecordsDetailSelection) => void;
  readonly selection: HealthRecordsDetailSelection;
}

type LoadState = 'loading' | 'ready' | 'failed';

/** Lists saved medication dose events for a selected period without charting them. */
export function HealthRecordsMedicationDetailScreen({
  loadMedicationData = loadEmptyHealthRecordsMedicationData,
  onBack,
  onSelectionChange,
  selection,
}: HealthRecordsMedicationDetailScreenProps) {
  const navigationInset = useNavigationContentInset();
  const [data, setData] = useState(emptyHealthRecordsMedicationData);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const now = useRef(new Date().toISOString()).current;
  const rows = useMemo(
    () => buildHealthRecordsMedicationDetailRows(data, selection.period, now),
    [data, now, selection.period],
  );
  const hasSharedNavigation = useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision,
    inputRevision: 0,
  } satisfies NavigationLeaveState);

  const reload = useCallback(async () => {
    const request = ++generation.current;
    setLoadState('loading');
    try {
      const next = await loadMedicationData();
      if (request !== generation.current) return;
      setData(next);
      setLoadState('ready');
    } catch {
      if (request === generation.current) setLoadState('failed');
    } finally {
      if (request === generation.current) setRevision(value => value + 1);
    }
  }, [loadMedicationData]);

  useEffect(() => {
    reload();
    return () => {
      // A result for an old route or period must not replace the active record list.
      generation.current += 1;
    };
  }, [reload]);

  const title = healthRecordCategoryTitle('medications') + ' 기록 상세';
  return (
    <FlatList
      data={rows}
      keyExtractor={row => row.doseEvent.id}
      contentContainerStyle={[styles.container, navigationInset]}
      ListEmptyComponent={
        loadState === 'ready' ? (
          <Text testID="health-records-detail-empty">
            {t('healthRecords.detailEmpty')}
          </Text>
        ) : undefined
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.topBar}>
            <Text
              accessibilityRole="header"
              style={styles.title}
              testID="health-records-detail-title"
            >
              {title}
            </Text>
            {hasSharedNavigation ? null : (
              <AppButton
                accessibilityLabel={navigationText.back.accessibilityLabel}
                onPress={onBack}
                testID="health-records-detail-back"
                title={navigationText.back.label}
                variant="secondary"
              />
            )}
          </View>
          <Text style={styles.description}>
            {t('healthRecords.detailDescription')}
          </Text>
          <View accessibilityRole="radiogroup" style={styles.periods}>
            {healthRecordPeriods.map(period => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: selection.period === period }}
                key={period}
                onPress={() => onSelectionChange({ ...selection, period })}
                style={[
                  styles.period,
                  selection.period === period && styles.selectedPeriod,
                ]}
                testID={'health-record-period-' + period}
              >
                <Text
                  style={[
                    styles.periodText,
                    selection.period === period && styles.selectedPeriodText,
                  ]}
                >
                  {healthRecordPeriodTitle(period)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.count}>
            {t('healthRecords.recordCount', { count: rows.length })}
          </Text>
          {loadState === 'loading' ? (
            <Text testID="health-records-detail-loading">
              {t('healthRecords.loading')}
            </Text>
          ) : null}
          {loadState === 'failed' ? (
            <View>
              <Text accessibilityRole="alert" style={styles.error}>
                {t('healthRecords.error')}
              </Text>
              <AppButton
                onPress={() => {
                  reload();
                }}
                testID="health-records-detail-retry"
                title={t('healthRecords.retry')}
                variant="secondary"
              />
            </View>
          ) : null}
        </View>
      }
      renderItem={({ item, index }) => (
        <HealthRecordsMedicationRecordRow index={index} row={item} />
      )}
      testID="health-records-detail-scroll"
    />
  );
}
