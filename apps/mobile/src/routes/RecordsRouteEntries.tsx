import { Pressable, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { MedicalDocumentImportAction } from '../medicalDocuments/MedicalDocumentImportAction';
import { ManualHistoryAction } from '../manualHistory/ManualHistoryAction';
import { styles } from './recordsRouteEntryStyles';

interface RecordsRouteEntriesProps {
  readonly onOpenSavedRecordings: () => void;
  readonly onOpenRecording: () => void;
  readonly onOpenHealthLibrary: () => void;
  readonly onOpenManualHistory: () => void;
  readonly medicalDocumentOpening: boolean;
  readonly medicalDocumentDisabled: boolean;
  readonly onImportMedicalDocument: () => void;
  readonly onImportMedicalPhoto: () => void;
}

/** Groups capture actions and existing record destinations without adding a new scroll owner. */
export function RecordsRouteEntries({
  onOpenSavedRecordings,
  onOpenRecording,
  onOpenHealthLibrary,
  onOpenManualHistory,
  medicalDocumentOpening,
  medicalDocumentDisabled,
  onImportMedicalDocument,
  onImportMedicalPhoto,
}: RecordsRouteEntriesProps) {
  return (
    <View style={styles.container}>
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="records-title"
      >
        {t('records.title')}
      </Text>
      <Text style={styles.subtitle}>{t('records.subtitle')}</Text>
      <View style={styles.captureActions} testID="records-capture-actions">
        <Pressable
          accessibilityRole="button"
          onPress={onOpenRecording}
          style={styles.captureAction}
          testID="records-new-recording"
        >
          <View
            style={styles.captureContent}
            testID="recording-capture-content"
          >
            <View style={styles.captureIcon} testID="recording-capture-icon">
              <AppSymbol name="mic.fill" color={appColors.primaryAction} />
            </View>
            <Text
              style={styles.captureActionTitle}
              testID="recording-capture-title"
            >
              {t('records.newRecording')}
            </Text>
          </View>
        </Pressable>
      </View>

      <View style={styles.materials} testID="records-materials">
        <Text accessibilityRole="header" style={styles.materialsTitle}>
          {t('records.myMaterials')}
        </Text>
        <View style={styles.materialRows}>
          <MedicalDocumentImportAction
            opening={medicalDocumentOpening}
            disabled={medicalDocumentDisabled}
            onPress={onImportMedicalDocument}
            showDivider
          />
          <MedicalDocumentImportAction
            source="photos"
            opening={medicalDocumentOpening}
            disabled={medicalDocumentDisabled}
            onPress={onImportMedicalPhoto}
            showDivider
          />
          <RecordsLibraryAction
            icon="doc.text"
            title={t('recording.library.title')}
            summary={t('records.savedRecordingsSummary')}
            onPress={onOpenSavedRecordings}
            testID="records-open-saved-recordings"
            showDivider
          />
          <ManualHistoryAction onPress={onOpenManualHistory} showDivider />
          <RecordsLibraryAction
            icon="folder"
            title={t('records.healthRecords')}
            summary={t('healthRecords.description')}
            onPress={onOpenHealthLibrary}
            testID="records-open-health-library"
          />
        </View>
      </View>
    </View>
  );
}

/** Keeps the imported and saved library links visually consistent within My Data. */
function RecordsLibraryAction({
  icon,
  title,
  summary,
  onPress,
  testID,
  showDivider = false,
}: {
  readonly icon: string;
  readonly title: string;
  readonly summary: string;
  readonly onPress: () => void;
  readonly testID: string;
  readonly showDivider?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.materialRow, showDivider && styles.rowDivider]}
      testID={testID}
    >
      <View style={styles.materialIcon}>
        <AppSymbol name={icon} color={appColors.primaryAction} />
      </View>
      <View style={styles.cardCopy}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSummary}>{summary}</Text>
      </View>
      <AppSymbol name="chevron.right" size={16} color={appColors.secondary} />
    </Pressable>
  );
}
