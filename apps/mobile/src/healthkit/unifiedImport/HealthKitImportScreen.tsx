import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { healthKitFeatures } from '../types';
import type { HealthKitFeature } from '../types';
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

type UnifiedImportCoordinator = ReturnType<
  typeof createUnifiedImportCoordinator
>;

interface HealthKitImportScreenProps {
  readonly copy: HealthKitImportScreenCopy;
  readonly coordinator: UnifiedImportCoordinator;
  readonly onMeasurement?: (measurement: UnifiedImportMeasurement) => void;
}

/** Presents selected HealthKit types and keeps per-type outcomes visible during sync. */
export function HealthKitImportScreen({
  copy,
  coordinator,
  onMeasurement,
}: HealthKitImportScreenProps) {
  const mounted = useRef(true);
  const [selected, setSelected] = useState<ReadonlySet<HealthKitFeature>>(
    new Set(),
  );
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
  }

  function startImport() {
    const selection: UnifiedImportSelection = {
      healthKitFeatures: healthKitFeatures.filter(feature =>
        selected.has(feature),
      ),
    };
    if (isRunning || selection.healthKitFeatures.length === 0) {
      return;
    }
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
        setRun(null);
      });
    } catch {
      setProgress(failedProgress(selection));
      setIsRunning(false);
      setRun(null);
    }
  }

  const phase = progress?.phase ?? 'queued';
  const selectedCount = selected.size;
  return (
    <View style={styles.container}>
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
              <Text>{copy.featureStatuses[outcome.status]}</Text>
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
      <Text>{copy.localOnly}</Text>
      <Text testID="unified-import-read-authorization">
        {copy.readAuthorization}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          disabled: selectedCount === 0 || isRunning,
        }}
        disabled={selectedCount === 0 || isRunning}
        onPress={startImport}
        style={styles.importButton}
        testID="unified-import-start"
      >
        <Text>{copy.importButton}</Text>
      </Pressable>
      {run ? (
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
    </View>
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
  };
}

const styles = StyleSheet.create({
  container: { gap: 12, padding: 20 },
  title: { fontSize: 22, fontWeight: '700' },
  option: { minHeight: 48, justifyContent: 'center', gap: 4 },
  importButton: { minHeight: 48, justifyContent: 'center' },
  cancelButton: { minHeight: 48, justifyContent: 'center' },
});
