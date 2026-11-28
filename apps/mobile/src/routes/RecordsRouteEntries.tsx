import { Pressable, View, useWindowDimensions } from 'react-native';
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
  readonly onOpenSchedule?: () => void;
  readonly onOpenHealthLibrary: () => void;
  readonly onOpenManualHistory?: () => void;
  readonly medicalDocumentOpening: boolean;
  readonly medicalDocumentDisabled: boolean;
  readonly onImportMedicalDocument: () => void;
  readonly onImportMedicalPhoto: () => void;
}

/** Keeps the primary recording action next to the page title, not in the library grid. */
export function RecordsHeading({
  onOpenRecording,
}: {
  readonly onOpenRecording: () => void;
}) {
  return (
    <View style={styles.heading} testID="records-hub-header">
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="records-title"
      >
        {t('records.title')}
      </Text>
      <View style={styles.captureGroup} testID="records-capture-actions">
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
  const items = [
    {
      icon: 'calendar',
      title: t('schedule.title'),
      onPress: onOpenSchedule,
      // A native document picker already owns the active route until it settles.
      disabled: medicalDocumentDisabled,
      testID: 'records-open-schedule',
    },
    {
      icon: 'doc.text',
      title: t('recording.library.title'),
      hint: t('records.savedRecordingsSummary'),
      onPress: onOpenSavedRecordings,
      testID: 'records-open-saved-recordings',
    },
    {
      icon: 'folder',
      title: t('records.healthRecords'),
      hint: t('healthRecords.description'),
      onPress: onOpenHealthLibrary,
      testID: 'records-open-health-library',
    },
    {
      icon: 'bookmark',
      title: t('savedMemory.title'),
      hint: t('records.conversationMemorySummary'),
      onPress: onOpenManualHistory,
      disabled: !materialsActive,
      testID: 'records-open-memory',
    },
    {
      icon: 'doc.on.doc',
      title: t('records.generatedConversationMaterials'),
      hint: t('records.generatedConversationMaterialsSummary'),
      onPress: onOpenGeneratedReports,
      disabled: !materialsActive,
      testID: 'records-open-generated-reports',
    },
  ];
  // Larger text uses full-width rows to keep long Korean labels readable.
  const rows = largeText
    ? items.map(item => [item])
    : [items.slice(0, 3), items.slice(3)];
  return (
    <View style={styles.sections}>
      <View style={styles.section} testID="records-materials">
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {t('records.myMaterials')}
        </Text>
        <View testID="records-material-directory">
          {rows.map((row, index) => (
            <View
              key={row[0]?.testID}
              style={[styles.gridRow, index > 0 && styles.rowDivider]}
            >
              {row.map(({ icon, title, hint, onPress, disabled, testID }) => (
                <Pressable
                  key={testID}
                  accessibilityRole="button"
                  accessibilityLabel={title}
                  accessibilityHint={hint}
                  accessibilityState={{ disabled: disabled || !onPress }}
                  disabled={disabled || !onPress}
                  onPress={onPress}
                  style={[
                    styles.tile,
                    largeText && styles.fullTile,
                    (disabled || !onPress) && styles.disabled,
                  ]}
                  testID={testID}
                >
                  <AppSymbol
                    name={icon}
                    color={appColors.primaryText}
                    size={22}
                  />
                  <Text style={styles.tileText}>{title}</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </View>
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
