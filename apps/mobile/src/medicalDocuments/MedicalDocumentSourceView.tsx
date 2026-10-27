import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { formatDateTime, t } from '../i18n';
import type { MedicalDocumentSourceRecord } from './medicalDocumentImportService';

export { MedicalDocumentSourceView } from './MedicalDocumentSourceDetail';

interface MedicalDocumentSourceLibraryProps {
  readonly documents: readonly MedicalDocumentSourceRecord[];
  readonly loading: boolean;
  readonly openingSource: boolean;
  readonly message: string | null;
  readonly onOpenDocument: (sourceId: string) => void;
}

/** Lists only imported medical sources and keeps their saved provenance reachable from Records. */
export function MedicalDocumentSourceLibrary({
  documents,
  loading,
  openingSource,
  message,
  onOpenDocument,
}: MedicalDocumentSourceLibraryProps) {
  return (
    <View style={styles.library} testID="medical-document-source-library">
      <Text accessibilityRole="header" style={styles.libraryTitle}>
        {t('medicalDocument.source.libraryTitle')}
      </Text>
      {loading ? (
        <Text testID="medical-document-source-loading">
          {t('medicalDocument.source.loading')}
        </Text>
      ) : documents.length === 0 && !message ? (
        <Text testID="medical-document-source-empty-list">
          {t('medicalDocument.source.emptyList')}
        </Text>
      ) : (
        documents.map((document, index) => {
          const title = document.title ?? t('medicalDocument.source.untitled');
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={title}
              disabled={openingSource}
              key={document.id}
              onPress={() => onOpenDocument(document.id)}
              style={[styles.sourceRow, openingSource && styles.disabled]}
              testID={`medical-document-source-${index}`}
            >
              <View style={styles.sourceCopy}>
                <Text style={styles.sourceTitle}>{title}</Text>
                <Text style={styles.sourceDate}>
                  {formatDateTime(new Date(document.ingestedAt))}
                </Text>
              </View>
              <Text style={styles.chevron} accessibilityElementsHidden>
                ›
              </Text>
            </Pressable>
          );
        })
      )}
      {openingSource ? (
        <Text accessibilityLiveRegion="polite">
          {t('medicalDocument.source.opening')}
        </Text>
      ) : null}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={styles.libraryStatus}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  library: { gap: 10, marginTop: 4 },
  libraryTitle: { color: appColors.text, fontSize: 20, fontWeight: '700' },
  sourceRow: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sourceCopy: { flex: 1, gap: 4 },
  sourceTitle: { color: appColors.text, fontSize: 16, fontWeight: '600' },
  sourceDate: { color: appColors.secondary, fontSize: 13 },
  chevron: { color: appColors.secondary, fontSize: 24 },
  libraryStatus: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
  disabled: { opacity: 0.55 },
});
