import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import type { HealthObservation } from '@orot/domain';
import type {
  HealthObservationCursor,
  HealthObservationPage,
} from '@orot/storage';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { NavigationLeaveState } from '../navigation';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { t } from '../i18n';
import { navigationText } from '../i18n/navigation';

interface HealthRecordsLibraryScreenProps {
  readonly loadObservations: (
    cursor: HealthObservationCursor | null,
  ) => Promise<HealthObservationPage>;
  readonly onBack: () => void;
}

type LoadState = 'loading' | 'ready' | 'failed';

/** Shows saved health values while keeping their import-only source metadata out of the UI. */
export function HealthRecordsLibraryScreen({
  loadObservations,
  onBack,
}: HealthRecordsLibraryScreenProps) {
  const navigationInset = useNavigationContentInset();
  const [observations, setObservations] = useState<
    readonly HealthObservation[]
  >([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [revision, setRevision] = useState(0);
  const [cursor, setCursor] = useState<HealthObservationCursor | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const hasSharedNavigation = useNavigationLeaveStateRegistration({
    // Reads do not own unsaved work and must never lock navigation.
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision,
    inputRevision: 0,
  } satisfies NavigationLeaveState);

  const reload = useCallback(
    async (after: HealthObservationCursor | null = null) => {
      if (pending.current) return;
      pending.current = true;
      const request = ++generation.current;
      setLoadState('loading');
      try {
        const page = await loadObservations(after);
        if (request !== generation.current) return;
        setObservations(current =>
          after ? [...current, ...page.records] : page.records,
        );
        setCursor(page.nextCursor);
        setLoadState('ready');
      } catch {
        if (request === generation.current) setLoadState('failed');
      } finally {
        if (request === generation.current) {
          pending.current = false;
          setRevision(current => current + 1);
        }
      }
    },
    [loadObservations],
  );

  useEffect(() => {
    pending.current = false;
    setObservations([]);
    setCursor(null);
    void reload();
    // Late responses from a previous loader or an unmounted route must not repopulate it.
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  return (
    <FlatList
      data={observations}
      keyExtractor={item => item.id}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={5}
      onEndReached={() => {
        if (cursor && loadState === 'ready') void reload(cursor);
      }}
      onEndReachedThreshold={0.5}
      contentContainerStyle={[styles.container, navigationInset]}
      testID="health-records-scroll"
      ListHeaderComponent={
        <>
          <View style={styles.topBar}>
            <Text
              accessibilityRole="header"
              style={styles.title}
              testID="health-records-title"
            >
              {t('healthRecords.title')}
            </Text>
            {hasSharedNavigation ? null : (
              <AppButton
                accessibilityLabel={navigationText.back.accessibilityLabel}
                onPress={onBack}
                testID="health-records-back"
                title={navigationText.back.label}
                variant="secondary"
              />
            )}
          </View>
          <Text style={styles.description}>
            {t('healthRecords.description')}
          </Text>
          {loadState === 'loading' ? (
            <Text testID="health-records-loading">
              {t('healthRecords.loading')}
            </Text>
          ) : null}
          {loadState === 'failed' ? (
            <View>
              <Text
                accessibilityRole="alert"
                style={styles.error}
                testID="health-records-error"
              >
                {t('healthRecords.error')}
              </Text>
              <AppButton
                onPress={() => {
                  void reload(cursor);
                }}
                testID="health-records-retry"
                title={t('healthRecords.retry')}
                variant="secondary"
              />
            </View>
          ) : null}
          {loadState === 'ready' && observations.length === 0 ? (
            <Text testID="health-records-empty">
              {t('healthRecords.empty')}
            </Text>
          ) : null}
        </>
      }
      renderItem={({ item: observation, index }) => (
        <View
          key={observation.id}
          style={styles.record}
          testID={`health-record-row-${index}`}
        >
          <Text
            style={styles.concept}
            testID={`health-record-row-${index}-concept`}
          >
            {observationName(observation.concept)}
          </Text>
          <Text testID={`health-record-row-${index}-value`}>
            {observationValue(observation)}
          </Text>
          <Text style={styles.date} testID={`health-record-row-${index}-time`}>
            {t('healthRecords.measuredAt', {
              timestamp: observation.effectiveAt,
            })}
          </Text>
        </View>
      )}
    />
  );
}

function observationName(concept: string): string {
  const knownNames: Readonly<Record<string, string>> = {
    heart_rate: t('healthkit.commonObservations.heartRate'),
    step_count: t('healthkit.commonObservations.steps'),
    body_mass: t('healthkit.commonObservations.bodyMass'),
    'blood pressure systolic': t('healthkit.bloodPressure.component.systolic'),
    'blood pressure diastolic': t(
      'healthkit.bloodPressure.component.diastolic',
    ),
  };
  return knownNames[concept] ?? concept;
}

function observationValue(observation: HealthObservation): string {
  switch (observation.value.kind) {
    case 'quantity':
      return `${observation.value.amount} ${observation.value.unit}`;
    case 'text':
      return observation.value.text;
    case 'boolean':
      return observation.value.value
        ? t('healthRecords.yes')
        : t('healthRecords.no');
  }
}

const styles = StyleSheet.create({
  container: { gap: 16, padding: 20 },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: { color: appColors.text, fontSize: 28, fontWeight: '700' },
  description: { color: appColors.secondary },
  record: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  concept: { color: appColors.text, fontSize: 16, fontWeight: '700' },
  date: { color: appColors.secondary, fontSize: 13 },
  error: { color: appColors.danger, marginBottom: 8 },
});
