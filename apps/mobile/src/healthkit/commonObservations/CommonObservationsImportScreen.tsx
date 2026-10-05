import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  commonObservationFeatures,
  type CommonObservationFeature,
} from './types';

export const commonObservationImportStatuses = [
  'idle',
  'importing',
  'complete',
  'empty',
  'overlap',
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
            <Text>{`${checked ? '☑' : '☐'} ${copy.featureNames[feature]}`}</Text>
          </Pressable>
        );
      })}
      <Text>{copy.localOnly}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: selected.size === 0 || isImporting }}
        disabled={selected.size === 0 || isImporting}
        onPress={startImport}
        style={styles.importButton}
        testID="common-observations-import"
      >
        <Text>{copy.importButton}</Text>
      </Pressable>
      <Text
        accessibilityLiveRegion="polite"
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
  importButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
