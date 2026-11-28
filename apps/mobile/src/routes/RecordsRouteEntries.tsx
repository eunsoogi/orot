import { Pressable, View, useWindowDimensions } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { PageHeading } from '../layout/PageHeading';
import { NativeGlassBackdrop } from '../layout/NativeGlassBackdrop';
import { AppSymbol } from '../layout/AppSymbol';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { MedicalDocumentImportAction } from '../medicalDocuments/MedicalDocumentImportAction';
import { RecordsMaterialLauncher } from './RecordsMaterialLauncher';
import { styles } from './recordsRouteEntryStyles';

interface RecordsRouteEntriesProps {
  readonly materialsActive?: boolean;
  readonly onOpenGeneratedReports?: () => void;
  readonly onOpenSavedRecordings: () => void;
  readonly onOpenSchedule?: () => void;
  readonly onOpenHealthLibrary: () => void;
  readonly onOpenManualHistory?: () => void;
  readonly medicalDocumentOpening: boolean;
  readonly medicalDocumentDisabled: boolean;
  readonly onImportMedicalDocument: () => void;
  readonly onImportMedicalPhoto: () => void;
}

/** Keeps the primary action at the trailing edge, even when large type wraps the heading. */
export function RecordsHeading({
  onOpenRecording,
}: {
  readonly onOpenRecording: () => void;
}) {
  return (
    <View style={styles.heading} testID="records-hub-header">
      <PageHeading style={styles.title} testID="records-title">
        {t('records.title')}
      </PageHeading>
      <View style={styles.captureGroup} testID="records-capture-actions">
        <Pressable
          accessibilityRole="button"
          onPress={onOpenRecording}
          style={styles.captureAction}
          testID="records-new-recording"
        >
          <NativeGlassBackdrop testID="recording-capture-glass" />
          <View
            style={styles.captureContent}
            testID="recording-capture-content"
          >
            <View testID="recording-capture-icon">
              <AppSymbol
                name="mic.fill"
                color={appColors.primaryText}
                size={16}
              />
            </View>
            <Text style={styles.captureTitle} testID="recording-capture-title">
              {t('records.newRecording')}
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

/** Groups destinations separately from imports without adding a new vertical scroll owner. */
export function RecordsRouteEntries({
  materialsActive = true,
  onOpenGeneratedReports,
  onOpenManualHistory,
  onOpenSavedRecordings,
  onOpenSchedule,
  onOpenHealthLibrary,
  medicalDocumentOpening,
  medicalDocumentDisabled,
  onImportMedicalDocument,
  onImportMedicalPhoto,
}: RecordsRouteEntriesProps) {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.4;
  // Keep the approved five destinations in launcher order; the tint reinforces, never replaces, their names.
  const items = [
    {
      icon: 'calendar',
      iconBackground: '#5e83d0',
      title: t('schedule.title'),
      onPress: onOpenSchedule,
      // A native document picker already owns the active route until it settles.
      disabled: medicalDocumentDisabled,
      testID: 'records-open-schedule',
    },
    {
      icon: 'waveform',
      iconBackground: '#8068ad',
      title: t('recording.library.title'),
      hint: t('records.savedRecordingsSummary'),
      onPress: onOpenSavedRecordings,
      testID: 'records-open-saved-recordings',
    },
    {
      icon: 'folder.badge.plus',
      iconBackground: '#3c8a92',
      title: t('records.healthRecords'),
      hint: t('healthRecords.description'),
      onPress: onOpenHealthLibrary,
      testID: 'records-open-health-library',
    },
    {
      icon: 'bookmark',
      iconBackground: '#ae701c',
      title: t('savedMemory.title'),
      hint: t('records.conversationMemorySummary'),
      onPress: onOpenManualHistory,
      disabled: !materialsActive,
      testID: 'records-open-memory',
    },
    {
      icon: 'doc.on.doc',
      iconBackground: '#557da3',
      title: t('records.generatedConversationMaterials'),
      hint: t('records.generatedConversationMaterialsSummary'),
      onPress: onOpenGeneratedReports,
      disabled: !materialsActive,
      testID: 'records-open-generated-reports',
    },
  ];
  return (
    <View style={styles.sections}>
      <View style={styles.section} testID="records-materials">
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {t('records.myMaterials')}
        </Text>
        <RecordsMaterialLauncher items={items} largeText={largeText} />
      </View>
      <View style={styles.section} testID="records-document-import">
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {t('records.importHeading')}
        </Text>
        <View style={[styles.importRow, largeText && styles.importStack]}>
          <MedicalDocumentImportAction
            compact
            opening={medicalDocumentOpening}
            disabled={medicalDocumentDisabled}
            onPress={onImportMedicalDocument}
          />
          <MedicalDocumentImportAction
            compact
            source="photos"
            opening={medicalDocumentOpening}
            disabled={medicalDocumentDisabled}
            onPress={onImportMedicalPhoto}
          />
        </View>
      </View>
    </View>
  );
}
