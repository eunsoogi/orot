import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { MedicalDocumentImportAction } from '../medicalDocuments/MedicalDocumentImportAction';
import {
  MedicalDocumentSourceLibrary,
  MedicalDocumentSourceView,
} from '../medicalDocuments/MedicalDocumentSourceView';
import { MedicalDocumentReview } from '../medicalDocuments/MedicalDocumentReview';
import { useMedicalDocumentImport } from '../medicalDocuments/useMedicalDocumentImport';
import type { MedicalDocumentImportService } from '../medicalDocuments/medicalDocumentImportService';
import { ManualHistoryAction } from '../manualHistory/ManualHistoryAction';

interface RecordsRouteProps {
  readonly onOpenSymptoms: () => void;
  readonly onOpenSavedRecordings: () => void;
  readonly onOpenRecording: () => void;
  readonly onOpenHealthLibrary: () => void;
  readonly documentImportService?: MedicalDocumentImportService;
  readonly onOpenManualHistory: () => void;
}

/** Keeps local sources discoverable and gates imported medical evidence on user review. */
export function RecordsRoute({
  onOpenSymptoms,
  onOpenSavedRecordings,
  onOpenRecording,
  onOpenHealthLibrary,
  documentImportService,
  onOpenManualHistory,
}: RecordsRouteProps) {
  const {
    activity,
    closeSavedDocument,
    discardMedicalDocument,
    message,
    openSavedDocument,
    saveMedicalDocument,
    selectMedicalDocument,
    savedDocuments,
    savedDocumentsLoading,
    sourceDetail,
    sourceLoading,
    sourceMessage,
    stagedDocument,
  } = useMedicalDocumentImport(documentImportService);

  if (stagedDocument) {
    return (
      <MedicalDocumentReview
        document={stagedDocument}
        busy={activity !== null}
        message={message}
        onSave={saveMedicalDocument}
        onCancel={discardMedicalDocument}
      />
    );
  }

  if (sourceDetail) {
    return (
      <MedicalDocumentSourceView
        document={sourceDetail}
        onBack={closeSavedDocument}
      />
    );
  }

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
      <Pressable
        accessibilityRole="button"
        onPress={onOpenRecording}
        style={styles.recordingAction}
        testID="records-new-recording"
      >
        <View style={styles.recordingIcon}>
          <AppSymbol
            name="mic.fill"
            size={30}
            color={appColors.primaryAction}
          />
        </View>
        <Text style={styles.recordingActionTitle}>
          {t('records.newRecording')}
        </Text>
      </Pressable>

      {/* Self-reported symptoms stay separate from imported clinical records. */}
      <Pressable
        accessibilityRole="button"
        onPress={onOpenSymptoms}
        style={styles.healthCard}
        testID="symptoms-open"
      >
        <View style={styles.healthIcon}>
          <AppSymbol
            name="square.and.pencil"
            size={28}
            color={appColors.primaryText}
          />
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>{t('symptoms.title')}</Text>
          <Text style={styles.cardSummary}>{t('symptoms.description')}</Text>
        </View>
        <AppSymbol name="chevron.right" size={16} color={appColors.secondary} />
      </Pressable>

      {/* A separate library keeps health records reachable regardless of saved-recording count. */}
      <Pressable
        accessibilityRole="button"
        onPress={onOpenSavedRecordings}
        style={styles.healthCard}
        testID="records-open-saved-recordings"
      >
        <View style={styles.healthIcon}>
          <AppSymbol name="doc.text" size={28} color={appColors.primaryText} />
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>{t('recording.library.title')}</Text>
          <Text style={styles.cardSummary}>
            {t('records.savedRecordingsSummary')}
          </Text>
        </View>
        <AppSymbol name="chevron.right" size={16} color={appColors.secondary} />
      </Pressable>

      <ManualHistoryAction onPress={onOpenManualHistory} />

      <Pressable
        accessibilityRole="button"
        onPress={onOpenHealthLibrary}
        style={styles.healthCard}
        testID="records-open-health-library"
      >
        <View
          style={[styles.healthIcon, { backgroundColor: appColors.greenSoft }]}
        >
          <AppSymbol name="folder" size={28} color={appColors.green} />
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>{t('records.healthRecords')}</Text>
          <Text style={styles.cardSummary}>
            {t('healthRecords.description')}
          </Text>
        </View>
        <Text style={styles.chevron} accessibilityElementsHidden>
          ›
        </Text>
      </Pressable>

      <MedicalDocumentImportAction
        opening={activity === 'selecting'}
        disabled={activity !== null}
        onPress={selectMedicalDocument}
      />
      <MedicalDocumentSourceLibrary
        documents={savedDocuments}
        loading={savedDocumentsLoading}
        openingSource={sourceLoading}
        message={sourceMessage}
        onOpenDocument={openSavedDocument}
      />
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={styles.status}
          testID="medical-document-import-status"
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: appColors.background,
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 24,
  },
  title: { color: appColors.text, fontSize: 36, fontWeight: '700' },
  subtitle: { color: appColors.secondary, fontSize: 16, lineHeight: 22 },
  recordingAction: {
    alignItems: 'center',
    backgroundColor: appColors.primaryAction,
    borderRadius: 22,
    justifyContent: 'center',
    gap: 12,
    minHeight: 108,
    marginTop: 4,
  },
  recordingIcon: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  recordingActionTitle: {
    color: appColors.onPrimary,
    fontSize: 21,
    fontWeight: '700',
  },
  healthCard: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 16,
    minHeight: 88,
    paddingHorizontal: 18,
  },
  healthIcon: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 14,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  cardCopy: { flex: 1, gap: 4 },
  cardTitle: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  cardSummary: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
  chevron: { color: appColors.secondary, fontSize: 24 },
  status: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
});
