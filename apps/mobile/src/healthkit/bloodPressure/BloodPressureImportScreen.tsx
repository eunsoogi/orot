import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AppButton as Button } from '../../layout/AppButton';
import { AppText as Text } from '../../layout/AppText';
import { useNavigationLeaveStateRegistration } from '../../navigation';
import type { NavigationLeaveState } from '../../navigation';
import { useNavigationContentInset } from '../../navigation/useNavigationContentInset';
import { t } from '../../i18n';
import { navigationText } from '../../i18n/navigation';
import type { BloodPressureSyncResult } from './types';
import {
  BloodPressureImportCompletion,
  type BloodPressureImportOutcome,
  type BloodPressureImportSummary,
} from './BloodPressureImportCompletion';

interface BloodPressureImportScreenProps {
  readonly onBack: () => void;
  readonly onOpenLibrary: () => void;
  readonly importBloodPressure: () => Promise<BloodPressureSyncResult>;
}

type ImportStatus = 'idle' | 'importing' | BloodPressureImportOutcome;

/** Presents the import outcome and keeps saved measurements in the Records library. */
export function BloodPressureImportScreen({
  onBack,
  onOpenLibrary,
  importBloodPressure,
}: BloodPressureImportScreenProps) {
  const navigationInset = useNavigationContentInset();
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [isImporting, setIsImporting] = useState(false);
  const [leaveRevision, setLeaveRevision] = useState(0);
  const [summary, setSummary] = useState<BloodPressureImportSummary | null>(
    null,
  );

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
    setSummary(null);
    setLeaveRevision(current => current + 1);
    try {
      const result = await importBloodPressure();
      setImportStatus(toImportStatus(result));
      if (result.status !== 'notRun') {
        // The upsert count includes additions and updates, so the UI uses a neutral label.
        setSummary({ saved: result.upserted, deleted: result.deleted });
      }
    } catch {
      setImportStatus('failed');
    } finally {
      setIsImporting(false);
      setLeaveRevision(current => current + 1);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.container, navigationInset]}
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
      {importStatus === 'idle' || importStatus === 'importing' ? (
        <>
          <Text>{t('healthkit.bloodPressure.description')}</Text>
          <Text testID="blood-pressure-read-authorization">
            {t('healthkit.bloodPressure.readAuthorization')}
          </Text>
          <Text>{t('healthkit.bloodPressure.localOnly')}</Text>
          <Button
            disabled={isImporting}
            onPress={() => {
              startImport().catch(() => undefined);
            }}
            testID="blood-pressure-import"
            title={t('healthkit.bloodPressure.import')}
          />
          <Text accessibilityLiveRegion="polite" testID="blood-pressure-status">
            {t(`healthkit.bloodPressure.status.${importStatus}`)}
          </Text>
          <Button
            disabled={isImporting}
            onPress={onOpenLibrary}
            testID="blood-pressure-open-library"
            title={t('healthkit.bloodPressure.openLibrary')}
            variant="secondary"
          />
        </>
      ) : (
        <BloodPressureImportCompletion
          onOpenLibrary={onOpenLibrary}
          onRetry={() => {
            startImport().catch(() => undefined);
          }}
          status={importStatus}
          summary={summary}
        />
      )}
    </ScrollView>
  );
}

function toImportStatus(
  result: BloodPressureSyncResult,
): BloodPressureImportOutcome {
  if (result.status === 'notRun') return 'unavailable';
  if (result.status === 'partial') return 'partial';
  return result.upserted + result.deleted > 0 ? 'complete' : 'empty';
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
    padding: 20,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: { fontSize: 22, fontWeight: '700' },
});
