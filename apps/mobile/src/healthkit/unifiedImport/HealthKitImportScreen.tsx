import { useEffect, useRef, useState } from 'react';
import { Button, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { healthKitFeatures } from '../types';
import type { HealthKitFeature } from '../types';
import { t } from '../../i18n';
import { EventKitImportSection } from './EventKitImportSection';
import { createUnifiedImportCoordinator } from './coordinator';
import type {
  UnifiedFeatureStatus,
  UnifiedImportMeasurement,
  UnifiedImportProgress,
  UnifiedImportRun,
  UnifiedImportSelection,
  UnifiedImportStatus,
} from './types';

export interface HealthKitImportScreenCopy {
  readonly title: string;
  readonly description: string;
  readonly localOnly: string;
  readonly readAuthorization: string;
  readonly importButton: string;
  readonly cancelButton: string;
  readonly featureNames: Readonly<Record<HealthKitFeature, string>>;
  readonly featureStatuses: Readonly<Record<UnifiedFeatureStatus, string>>;
  readonly phaseStatuses: Readonly<Record<UnifiedImportStatus, string>>;
  readonly changeSummary: (imported: number, deleted: number) => string;
}

export type UnifiedImportCoordinator = ReturnType<
  typeof createUnifiedImportCoordinator
>;

interface HealthKitImportScreenProps {
  readonly copy: HealthKitImportScreenCopy;
  readonly coordinator: UnifiedImportCoordinator;
  readonly onBack?: () => void;
  readonly onMeasurement?: (measurement: UnifiedImportMeasurement) => void;
}

/** Presents selected providers and keeps per-provider outcomes visible during sync. */
export function HealthKitImportScreen({
  copy,
  coordinator,
  onBack,
  onMeasurement,
}: HealthKitImportScreenProps) {
  const mounted = useRef(true);
  const [selected, setSelected] = useState<ReadonlySet<HealthKitFeature>>(
    new Set(),
  );
  const [eventKitSelected, setEventKitSelected] = useState(false);
  const [progress, setProgress] = useState<UnifiedImportProgress | null>(null);
  const [run, setRun] = useState<UnifiedImportRun | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  function toggleFeature(feature: HealthKitFeature) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(feature)) next.delete(feature);
      else next.add(feature);
      return next;
    });
    setProgress(null);
    setRun(null);
  }

  function toggleEventKit() {
    setEventKitSelected(current => !current);
    setProgress(null);
    setRun(null);
  }

  function startImport() {
    const selection: UnifiedImportSelection = {
      healthKitFeatures: healthKitFeatures.filter(feature =>
        selected.has(feature),
      ),
      eventKit: eventKitSelected,
    };
    if (
      isRunning ||
      (selection.healthKitFeatures.length === 0 && !selection.eventKit)
    ) {
      return;
    }
    setProgress(null);
    setRun(null);
    setIsRunning(true);
    try {
      const active = coordinator.start(selection, {
        onProgress: value => {
          if (mounted.current) setProgress(value);
        },
        ...(onMeasurement ? { onMeasurement } : {}),
      });
      setRun(active);
      active.result.then(result => {
        if (!mounted.current) return;
        setProgress(result.progress);
        setIsRunning(false);
      });
    } catch {
      setProgress(failedProgress(selection));
      setIsRunning(false);
      setRun(null);
    }
  }

  const phase = progress?.phase ?? 'queued';
  const hasSelection = selected.size > 0 || eventKitSelected;
  return (
    <ScrollView contentContainerStyle={styles.container}>
      {onBack ? (
        <Button
          onPress={onBack}
          testID="healthkit-unified-import-back"
          title={t('healthkit.unifiedImport.back')}
        />
      ) : null}
      <Text accessibilityRole="header" style={styles.title}>
        {copy.title}
      </Text>
      <Text>{copy.description}</Text>
      {healthKitFeatures.map(feature => {
        const checked = selected.has(feature);
        const outcome = progress?.features[feature];
        return (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked, disabled: isRunning }}
            disabled={isRunning}
            key={feature}
            onPress={() => toggleFeature(feature)}
            style={styles.option}
            testID={`unified-import-toggle-${feature}`}
          >
            <Text>{`${checked ? '☑' : '☐'} ${copy.featureNames[feature]}`}</Text>
            {outcome && outcome.status !== 'notSelected' ? (
              <Text testID={`unified-import-feature-status-${feature}`}>
                {copy.featureStatuses[outcome.status]}
              </Text>
            ) : null}
            {outcome &&
            outcome.importedCount !== null &&
            outcome.deletedCount !== null ? (
              <Text>
                {copy.changeSummary(
                  outcome.importedCount,
                  outcome.deletedCount,
                )}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
      <EventKitImportSection
        disabled={isRunning}
        onToggle={toggleEventKit}
        progress={progress?.eventKit ?? null}
        run={run}
        selected={eventKitSelected}
      />
      <Text>{copy.localOnly}</Text>
      <Text testID="unified-import-read-authorization">
        {copy.readAuthorization}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          disabled: !hasSelection || isRunning,
        }}
        disabled={!hasSelection || isRunning}
        onPress={startImport}
        style={styles.importButton}
        testID="unified-import-start"
      >
        <Text>{copy.importButton}</Text>
      </Pressable>
      {run && isRunning ? (
        <Pressable
          accessibilityRole="button"
          disabled={!isRunning}
          onPress={() => run.cancel()}
          style={styles.cancelButton}
          testID="unified-import-cancel"
        >
          <Text>{copy.cancelButton}</Text>
        </Pressable>
      ) : null}
      <Text accessibilityLiveRegion="polite" testID="unified-import-status">
        {copy.phaseStatuses[phase]}
      </Text>
    </ScrollView>
  );
}

function failedProgress(
  selection: UnifiedImportSelection,
): UnifiedImportProgress {
  const features = Object.fromEntries(
    healthKitFeatures.map(feature => [
      feature,
      {
        status: selection.healthKitFeatures.includes(feature)
          ? 'failed'
          : 'notSelected',
        importedCount: null,
        deletedCount: null,
      },
    ]),
  ) as UnifiedImportProgress['features'];
  return {
    phase: 'failed',
    features,
    eventKit: {
      status: selection.eventKit ? 'failed' : 'notSelected',
      access: null,
      candidates: [],
      appointmentConfirmed: false,
    },
  };
}

const styles = StyleSheet.create({
  container: { gap: 12, padding: 20 },
  title: { fontSize: 22, fontWeight: '700' },
  option: { minHeight: 48, justifyContent: 'center', gap: 4 },
  importButton: { minHeight: 48, justifyContent: 'center' },
  cancelButton: { minHeight: 48, justifyContent: 'center' },
});
