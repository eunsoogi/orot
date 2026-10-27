import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { StagedMedicalDocument } from './medicalDocumentNativeBridge';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';

interface MedicalDocumentReviewProps {
  readonly document: StagedMedicalDocument;
  readonly busy: boolean;
  readonly message: string | null;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}

/** Shows extracted text before the user adds its unconfirmed evidence to local records. */
export function MedicalDocumentReview({
  document,
  busy,
  message,
  onSave,
  onCancel,
}: MedicalDocumentReviewProps) {
  return (
    <View style={styles.container}>
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="medical-document-review-title"
      >
        {t('medicalDocument.review.title')}
      </Text>
      <Text style={styles.filename} testID="medical-document-review-filename">
        {document.displayName}
      </Text>
      <Text
        style={styles.description}
        testID="medical-document-review-description"
      >
        {t('medicalDocument.review.description')}
      </Text>
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={styles.status}
          testID="medical-document-import-status"
        >
          {message}
        </Text>
      ) : null}

      <ScrollView
        accessibilityLabel={t('medicalDocument.review.content')}
        style={styles.preview}
        contentContainerStyle={styles.previewContent}
        testID="medical-document-review-content"
      >
        {document.sections.map((section, index) => (
          <View
            key={section.id}
            style={styles.section}
            testID={`medical-document-review-section-${index}`}
          >
            {section.pageNumber === undefined ? null : (
              <Text
                style={styles.page}
                testID={`medical-document-review-page-${index}`}
              >
                {t('medicalDocument.review.page', { page: section.pageNumber })}
              </Text>
            )}
            <Text
              selectable
              style={styles.text}
              testID={`medical-document-review-text-${index}`}
            >
              {section.text}
            </Text>
          </View>
        ))}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onSave}
        style={[styles.saveButton, busy && styles.disabled]}
        testID="medical-document-save"
      >
        <Text style={styles.saveText}>
          {busy
            ? t('medicalDocument.review.saving')
            : t('medicalDocument.review.save')}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onCancel}
        style={[styles.cancelButton, busy && styles.disabled]}
        testID="medical-document-cancel"
      >
        <Text style={styles.cancelText}>
          {t('medicalDocument.review.cancel')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appColors.background,
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 24,
  },
  title: { color: appColors.text, fontSize: 28, fontWeight: '700' },
  filename: { color: appColors.primaryText, fontSize: 16, fontWeight: '600' },
  description: { color: appColors.secondary, fontSize: 15, lineHeight: 22 },
  status: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
  preview: {
    flex: 1,
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewContent: { gap: 16, padding: 16 },
  section: { gap: 8 },
  page: { color: appColors.secondary, fontSize: 13, fontWeight: '600' },
  text: { color: appColors.text, fontSize: 16, lineHeight: 24 },
  saveButton: {
    alignItems: 'center',
    backgroundColor: appColors.primaryAction,
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 52,
  },
  saveText: { color: appColors.onPrimary, fontSize: 17, fontWeight: '700' },
  cancelButton: {
    alignItems: 'center',
    borderColor: appColors.border,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 48,
  },
  cancelText: { color: appColors.secondary, fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.55 },
});
