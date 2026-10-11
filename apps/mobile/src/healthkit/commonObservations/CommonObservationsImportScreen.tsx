import { useState } from 'react';
import { AppText as Text } from '../../layout/AppText';
import { CheckboxIndicator } from '../../layout/CheckboxIndicator';
import { Pressable, StyleSheet, View } from 'react-native';
import { appColors } from '../../layout/appColors';
import { useNavigationLeaveStateRegistration } from '../../navigation';
import type { NavigationLeaveState } from '../../navigation';
import {
  commonObservationFeatures,
  type CommonObservationFeature,
} from './types';

export const commonObservationImportStatuses = [
  'idle',
  'importing',
  'complete',
  'empty',
  'unavailable',
  'unsupportedFeature',
  'unsupportedPlatform',
  'unsupportedData',
  'partial',
  'failed',
] as const;

export type CommonObservationImportStatus =
  (typeof commonObservationImportStatuses)[number];

export interface CommonObservationsImportCopy {
  readonly title: string;
  readonly description: string;
  readonly localOnly: string;
  readonly importButton: string;
  readonly featureNames: Readonly<Record<CommonObservationFeature, string>>;
  readonly statuses: Readonly<Record<CommonObservationImportStatus, string>>;
  readonly changeSummary: (
    importedCount: number,
    deletedCount: number,
    unsupportedCount: number,
  ) => string;
}

export interface CommonObservationsImportResult {
  readonly status: Exclude<
    CommonObservationImportStatus,
    'idle' | 'importing' | 'failed'
  >;
  readonly importedCount: number;
  readonly deletedCount: number;
  readonly unsupportedCount: number;
}

interface CommonObservationsImportScreenProps {
  readonly copy: CommonObservationsImportCopy;
  readonly onImport: (
    features: readonly CommonObservationFeature[],
  ) => Promise<CommonObservationsImportResult>;
}

/** Receives copy from the shared i18n owner so this feature stays self-contained. */
export function CommonObservationsImportScreen({
  copy,
  onImport,
}: CommonObservationsImportScreenProps) {
  const [selected, setSelected] = useState<
    ReadonlySet<CommonObservationFeature>
  >(new Set());
  const [status, setStatus] = useState<CommonObservationImportStatus>('idle');
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [deletedCount, setDeletedCount] = useState<number | null>(null);
  const [unsupportedCount, setUnsupportedCount] = useState<number | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [revision, setRevision] = useState(0);
  const [inputRevision, setInputRevision] = useState(0);

  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: !isImporting && status === 'idle' && selected.size > 0,
    isRecording: false,
    hasOngoingOperation: false,
    backgroundOperationKind: isImporting
      ? 'common-observation-import'
      : undefined,
    revision,
    inputRevision,
  } satisfies NavigationLeaveState);

  function toggleFeature(feature: CommonObservationFeature) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(feature)) next.delete(feature);
      else next.add(feature);
      return next;
    });
    setStatus('idle');
    setImportedCount(null);
    setDeletedCount(null);
    setUnsupportedCount(null);
    setRevision(current => current + 1);
    setInputRevision(current => current + 1);
  }

  async function startImport() {
    const features = commonObservationFeatures.filter(feature =>
      selected.has(feature),
    );
    if (features.length === 0 || isImporting) return;

    setStatus('importing');
    setImportedCount(null);
    setDeletedCount(null);
    setUnsupportedCount(null);
    setIsImporting(true);
    setRevision(current => current + 1);
    try {
      const result = await onImport(features);
      setStatus(result.status);
      setImportedCount(result.importedCount);
      setDeletedCount(result.deletedCount);
      setUnsupportedCount(result.unsupportedCount);
    } catch {
      setStatus('failed');
    } finally {
      setIsImporting(false);
      setRevision(current => current + 1);
    }
  }

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {copy.title}
      </Text>
      <Text>{copy.description}</Text>
      {commonObservationFeatures.map(feature => {
        const checked = selected.has(feature);
        return (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked, disabled: isImporting }}
            disabled={isImporting}
            key={feature}
            onPress={() => toggleFeature(feature)}
            style={styles.option}
            testID={`common-observations-toggle-${feature}`}
          >
            <View style={styles.optionContent}>
              <CheckboxIndicator
                checked={checked}
                disabled={isImporting}
                testID={`common-observations-indicator-${feature}`}
              />
              <Text>{copy.featureNames[feature]}</Text>
            </View>
          </Pressable>
        );
      })}
      <Text>{copy.localOnly}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: selected.size === 0 || isImporting }}
        disabled={selected.size === 0 || isImporting}
        // Let the parent route handle Back while HealthKit I/O continues.
        onPress={() => {
          startImport().catch(() => undefined);
        }}
        style={[
          styles.importButton,
          (selected.size === 0 || isImporting) && styles.importButtonDisabled,
        ]}
        testID="common-observations-import"
      >
        <Text style={styles.importButtonLabel}>{copy.importButton}</Text>
      </Pressable>
      <Text
        accessibilityLiveRegion="polite"
        style={status === 'failed' ? styles.error : undefined}
        testID="common-observations-status"
      >
        {copy.statuses[status]}
        {importedCount === null ||
        deletedCount === null ||
        unsupportedCount === null
          ? ''
          : ` ${copy.changeSummary(importedCount, deletedCount, unsupportedCount)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, padding: 20 },
  title: { fontSize: 22, fontWeight: '700' },
  option: { minHeight: 44, justifyContent: 'center' },
  optionContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  importButton: {
    alignItems: 'center',
    backgroundColor: appColors.primaryAction,
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 18,
  },
  importButtonDisabled: { opacity: 0.45 },
  error: { color: appColors.danger },
  // This filled primary action keeps its foreground readable in both palettes.
  importButtonLabel: {
    color: appColors.onPrimary,
    fontWeight: '600',
  },
});
