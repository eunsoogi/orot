import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { MedicalDocumentImportAction } from '../medicalDocuments/MedicalDocumentImportAction';
import { ManualHistoryAction } from '../manualHistory/ManualHistoryAction';
import { hubSpacing } from '../layout/hubSpacing';

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
          <View style={styles.captureIcon}>
            <AppSymbol name="mic.fill" color={appColors.primaryAction} />
          </View>
          <Text style={styles.captureActionTitle}>
            {t('records.newRecording')}
          </Text>
          <AppSymbol
            name="chevron.right"
            size={16}
            color={appColors.secondary}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onOpenSymptoms}
          style={styles.captureAction}
          testID="symptoms-open"
        >
          <View style={styles.captureIcon}>
            <AppSymbol
              name="square.and.pencil"
              color={appColors.primaryAction}
            />
          </View>
          <Text style={styles.captureActionTitle}>{t('symptoms.title')}</Text>
          <AppSymbol
            name="chevron.right"
            size={16}
            color={appColors.secondary}
          />
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

const styles = StyleSheet.create({
  container: {
    gap: hubSpacing.item,
    minWidth: 0,
  },
  title: { color: appColors.text, fontSize: 36, fontWeight: '700' },
  subtitle: { color: appColors.secondary, fontSize: 16, lineHeight: 22 },
  captureActions: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: hubSpacing.item,
    marginTop: 4,
  },
  captureAction: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 76,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  captureIcon: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  captureActionTitle: {
    color: appColors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21,
    minWidth: 0,
  },
  materials: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  materialsTitle: {
    borderBottomColor: appColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    color: appColors.text,
    fontSize: 21,
    fontWeight: '700',
    paddingBottom: 10,
  },
  materialRows: { minWidth: 0 },
  materialRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 70,
    minWidth: 0,
    paddingVertical: 9,
  },
  rowDivider: {
    borderBottomColor: appColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  materialIcon: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  cardCopy: { flex: 1, gap: 3, minWidth: 0 },
  cardTitle: { color: appColors.text, fontSize: 16, fontWeight: '700' },
  cardSummary: { color: appColors.secondary, fontSize: 14, lineHeight: 19 },
});
