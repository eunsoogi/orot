import { AppButton as Button } from '../../layout/AppButton';
import { AppText as Text } from '../../layout/AppText';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigationLeaveStateRegistration } from '../../navigation';
import type { NavigationLeaveState } from '../../navigation';
import { navigationText } from '../../i18n/navigation';
import { BOTTOM_NAVIGATION_CONTENT_INSET } from '../../navigation/navigationLayout';
import { t } from '../../i18n';
import { appColors } from '../../layout/appColors';
import type {
  BloodPressureComponent,
  BloodPressureObservation,
  BloodPressureSyncResult,
} from './types';

interface BloodPressureImportScreenProps {
  readonly onBack: () => void;
  readonly importBloodPressure: () => Promise<BloodPressureSyncResult>;
  readonly loadObservations: () => Promise<readonly BloodPressureObservation[]>;
}

type ImportStatus =
  | 'idle'
  | 'importing'
  | 'complete'
  | 'empty'
  | 'unavailable'
  | 'partial'
  | 'failed';

/** Shows only saved HealthKit components and never fills in an absent partner. */
export function BloodPressureImportScreen({
  onBack,
  importBloodPressure,
  loadObservations,
}: BloodPressureImportScreenProps) {
  const [observations, setObservations] = useState<
    readonly BloodPressureObservation[]
  >([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>(
    'loading',
  );
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [isImporting, setIsImporting] = useState(false);
  const [leaveRevision, setLeaveRevision] = useState(0);

  const reload = useCallback(async () => {
    setLoadState('loading');
    try {
      setObservations(await loadObservations());
      setLoadState('ready');
    } catch {
      setLoadState('failed');
    }
  }, [loadObservations]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  const hasSharedNavigation = useNavigationLeaveStateRegistration({
    canLeave: !isImporting,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: leaveRevision,
    inputRevision: 0,
  } satisfies NavigationLeaveState);

  async function startImport() {
    if (isImporting) return;
    setIsImporting(true);
    setImportStatus('importing');
    setLeaveRevision(current => current + 1);
    try {
      const result = await importBloodPressure();
      setImportStatus(toImportStatus(result));
      await reload();
    } catch {
      setImportStatus('failed');
    } finally {
      setIsImporting(false);
      setLeaveRevision(current => current + 1);
    }
  }

  const componentCounts = new Map<BloodPressureComponent, number>();
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      testID="blood-pressure-scroll"
    >
      <View style={styles.topBar}>
        <Text
          accessibilityRole="header"
          style={styles.title}
          testID="blood-pressure-title"
        >
          {t('healthkit.bloodPressure.title')}
        </Text>
        {hasSharedNavigation ? null : (
          <Button
            accessibilityLabel={navigationText.back.accessibilityLabel}
            disabled={isImporting}
            onPress={onBack}
            testID="blood-pressure-back"
            title={navigationText.back.label}
          />
        )}
      </View>
      <Text>{t('healthkit.bloodPressure.description')}</Text>
      <Text testID="blood-pressure-read-authorization">
        {t('healthkit.bloodPressure.readAuthorization')}
      </Text>
      <Text>{t('healthkit.bloodPressure.localOnly')}</Text>
      <Button
        disabled={isImporting || loadState === 'loading'}
        onPress={() => {
          startImport().catch(() => undefined);
        }}
        testID="blood-pressure-import"
        title={t('healthkit.bloodPressure.import')}
      />
      <Text accessibilityLiveRegion="polite" testID="blood-pressure-status">
        {t(`healthkit.bloodPressure.status.${importStatus}`)}
      </Text>

      {loadState === 'loading' ? (
        <Text testID="blood-pressure-loading">
          {t('healthkit.bloodPressure.loading')}
        </Text>
      ) : null}
      {loadState === 'failed' ? (
        <View>
          <Text
            accessibilityRole="alert"
            style={styles.error}
            testID="blood-pressure-load-error"
          >
            {t('healthkit.bloodPressure.loadError')}
          </Text>
          <Button
            onPress={() => {
              reload().catch(() => undefined);
            }}
            testID="blood-pressure-retry-load"
            title={t('healthkit.bloodPressure.retry')}
          />
        </View>
      ) : null}
      {loadState === 'ready' && observations.length === 0 ? (
        <Text testID="blood-pressure-empty">
          {t('healthkit.bloodPressure.empty')}
        </Text>
      ) : null}
      {observations.map(observation => {
        const component = componentForConcept(observation.concept);
        if (!component || observation.value.kind !== 'quantity') return null;
        const index = componentCounts.get(component) ?? 0;
        componentCounts.set(component, index + 1);
        return (
          <BloodPressureReading
            component={component}
            index={index}
            key={observation.id}
            observation={observation}
          />
        );
      })}
    </ScrollView>
  );
}

function BloodPressureReading({
  component,
  index,
  observation,
}: {
  readonly component: BloodPressureComponent;
  readonly index: number;
  readonly observation: BloodPressureObservation;
}) {
  if (observation.value.kind !== 'quantity') return null;
  const source =
    observation.provenance.source?.sourceName ??
    observation.provenance.source?.sourceIdentifier ??
    'HealthKit';
  const representation = observation.value.sourceRepresentation;
  const readingId = `blood-pressure-reading-${component}-${index}`;

  return (
    <View style={styles.reading} testID={`${readingId}-card`}>
      <Text testID={`${readingId}-value`}>
        {`${t(`healthkit.bloodPressure.component.${component}`)} ${observation.value.amount} ${observation.value.unit}`}
      </Text>
      <Text testID={`${readingId}-time`}>
        {t('healthkit.bloodPressure.measurementTime', {
          timestamp: observation.effectiveAt,
        })}
      </Text>
      <Text testID={`${readingId}-source`}>
        {t('healthkit.bloodPressure.source', { source })}
      </Text>
      <Text testID={`${readingId}-original`}>
        {representation?.status === 'available'
          ? t('healthkit.bloodPressure.originalAvailable', {
              amount: representation.amount,
              unit: representation.unit,
            })
          : t('healthkit.bloodPressure.originalUnavailable')}
      </Text>
    </View>
  );
}

function componentForConcept(concept: string): BloodPressureComponent | null {
  if (concept === 'blood pressure systolic') return 'systolic';
  if (concept === 'blood pressure diastolic') return 'diastolic';
  return null;
}

function toImportStatus(result: BloodPressureSyncResult): ImportStatus {
  if (result.status === 'notRun') return 'unavailable';
  if (result.status === 'partial') return 'partial';
  return result.upserted + result.deleted > 0 ? 'complete' : 'empty';
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
    padding: 20,
    paddingBottom: 20 + BOTTOM_NAVIGATION_CONTENT_INSET,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: { fontSize: 22, fontWeight: '700' },
  error: { color: appColors.danger },
  reading: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
});
