import { Pressable, View, useWindowDimensions } from 'react-native';
import { useCaptureActionHeights } from './useCaptureActionHeights';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { MedicalDocumentImportAction } from '../medicalDocuments/MedicalDocumentImportAction';
import { ManualHistoryAction } from '../manualHistory/ManualHistoryAction';
import { styles } from './recordsRouteEntryStyles';

interface RecordsRouteEntriesProps {
  readonly onOpenSymptoms: () => void;
  readonly onOpenSavedRecordings: () => void;
  readonly onOpenRecording: () => void;
  readonly onOpenHealthLibrary: () => void;
  readonly onOpenManualHistory: () => void;
  readonly medicalDocumentOpening: boolean;
  readonly medicalDocumentDisabled: boolean;
  readonly onImportMedicalDocument: () => void;
}

/** Groups capture actions and existing record destinations without adding a new scroll owner. */
export function RecordsRouteEntries({
  onOpenSymptoms,
  onOpenSavedRecordings,
  onOpenRecording,
  onOpenHealthLibrary,
  onOpenManualHistory,
  medicalDocumentOpening,
  medicalDocumentDisabled,
  onImportMedicalDocument,
}: RecordsRouteEntriesProps) {
  const { fontScale, width } = useWindowDimensions();
  // At larger text sizes, full-width peers leave room for labels without limiting Dynamic Type.
  const stackCaptureActions = fontScale > 1;
  const { commonHeight, recordHeight } = useCaptureActionHeights(
    width,
    fontScale,
  );
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
      <View
        style={[
          styles.captureActions,
          stackCaptureActions && styles.stackedActions,
        ]}
        testID="records-capture-actions"
      >
        <Pressable
          accessibilityRole="button"
          onPress={onOpenRecording}
          style={[
            styles.captureAction,
            stackCaptureActions &&
              commonHeight > 24 && { minHeight: commonHeight },
          ]}
          testID="records-new-recording"
        >
          <View
            onLayout={event => recordHeight(0, event.nativeEvent.layout.height)}
            style={styles.captureContent}
            testID="recording-capture-content"
          >
            <View style={styles.captureIcon}>
              <AppSymbol name="mic.fill" color={appColors.primaryAction} />
            </View>
            <Text style={styles.captureActionTitle}>
              {t('records.newRecording')}
            </Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onOpenSymptoms}
          style={[
            styles.captureAction,
            stackCaptureActions &&
              commonHeight > 24 && { minHeight: commonHeight },
          ]}
          testID="symptoms-open"
        >
          <View
            onLayout={event => recordHeight(1, event.nativeEvent.layout.height)}
            style={styles.captureContent}
            testID="symptom-capture-content"
          >
            <View style={styles.captureIcon}>
              <AppSymbol
                name="square.and.pencil"
                color={appColors.primaryAction}
              />
            </View>
            <Text style={styles.captureActionTitle}>{t('symptoms.title')}</Text>
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
