import { useContext, type ReactNode } from 'react';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { hubSpacing } from '../layout/hubSpacing';
import { RecordsHubHeadingContext } from './RecordsHubBanner';
import { Pressable, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { MedicalDocumentImportAction } from '../medicalDocuments/MedicalDocumentImportAction';
import { styles } from './recordsRouteEntryStyles';

interface RecordsRouteEntriesProps {
  readonly materialsActive?: boolean;
  readonly onOpenGeneratedReports?: () => void;
  readonly onOpenSavedRecordings: () => void;
  readonly onOpenRecording: () => void;
  readonly onOpenHealthLibrary: () => void;
  readonly onOpenManualHistory?: () => void;
  readonly medicalDocumentOpening: boolean;
  readonly medicalDocumentDisabled: boolean;
  readonly onImportMedicalDocument: () => void;
  readonly onImportMedicalPhoto: () => void;
}

/** Groups capture actions and existing record destinations without adding a new scroll owner. */
export function RecordsRouteEntries({
  materialsActive = true,
  onOpenGeneratedReports,
  onOpenManualHistory,
  onOpenSavedRecordings,
  onOpenRecording,
  onOpenHealthLibrary,
  medicalDocumentOpening,
  medicalDocumentDisabled,
  onImportMedicalDocument,
  onImportMedicalPhoto,
}: RecordsRouteEntriesProps) {
  const hubOwnsHeading = useContext(RecordsHubHeadingContext);
  return (
    <View style={styles.container}>
      {!hubOwnsHeading ? (
        <>
          <Text
            accessibilityRole="header"
            style={styles.title}
            testID="records-title"
          >
            {t('records.title')}
          </Text>
          <Text style={styles.subtitle} testID="records-subtitle">
            {t('records.subtitle')}
          </Text>
        </>
      ) : null}
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

      <AdaptiveColumns
        testID="records-material-columns"
        stackedGap={hubSpacing.item}
        secondary={
          <RecordsMaterials
            title={t('records.conversationMaterials')}
            testID="records-conversation-materials"
          >
            <RecordsLibraryAction
              icon="bookmark"
              title={t('savedMemory.title')}
              summary={t('records.conversationMemorySummary')}
              onPress={onOpenManualHistory}
              disabled={!materialsActive}
              testID="records-open-memory"
              showDivider
            />
            <RecordsLibraryAction
              icon="doc.on.doc"
              title={t('records.generatedConversationMaterials')}
              summary={t('records.generatedConversationMaterialsSummary')}
              onPress={onOpenGeneratedReports}
              disabled={!materialsActive}
              testID="records-open-generated-reports"
            />
          </RecordsMaterials>
        }
        primary={
          <RecordsMaterials
            title={t('records.myMaterials')}
            testID="records-materials"
          >
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
            <RecordsLibraryAction
              icon="folder"
              title={t('records.healthRecords')}
              summary={t('healthRecords.description')}
              onPress={onOpenHealthLibrary}
              testID="records-open-health-library"
            />
          </RecordsMaterials>
        }
      />
    </View>
  );
}

/** Both panels share the exact heading, divider, and card chrome. */
function RecordsMaterials({
  title,
  testID,
  children,
}: {
  readonly title: string;
  readonly testID: string;
  readonly children: ReactNode;
}) {
  return (
    <View style={styles.materials} testID={testID}>
      <Text accessibilityRole="header" style={styles.materialsTitle}>
        {title}
      </Text>
      <View style={styles.materialRows}>{children}</View>
    </View>
  );
}

/** Opens an existing local library with the same row styling in either panel. */
function RecordsLibraryAction({
  icon,
  title,
  summary,
  onPress,
  testID,
  disabled = false,
  showDivider = false,
}: {
  readonly icon: string;
  readonly title: string;
  readonly summary: string;
  readonly onPress?: () => void;
  readonly disabled?: boolean;
  readonly testID: string;
  readonly showDivider?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || !onPress }}
      disabled={disabled || !onPress}
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
