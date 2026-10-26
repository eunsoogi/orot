import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { EvidenceSpan } from '@orot/domain';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { formatDateTime, t } from '../i18n';
import type {
  MedicalDocumentSourceRecord,
  SavedMedicalDocument,
} from './medicalDocumentImportService';

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

interface MedicalDocumentSourceViewProps {
  readonly document: SavedMedicalDocument;
  readonly onBack: () => void;
}

/** Reopens saved imported text with its source locator and review state intact. */
export function MedicalDocumentSourceView({
  document,
  onBack,
}: MedicalDocumentSourceViewProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      testID="medical-document-source-view"
    >
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={styles.backButton}
        testID="medical-document-source-back"
      >
        <Text style={styles.backText}>{t('medicalDocument.source.back')}</Text>
      </Pressable>
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="medical-document-source-title"
      >
        {document.title ?? t('medicalDocument.source.untitled')}
      </Text>
      <Text
        style={styles.detailStatus}
        testID="medical-document-source-review-state"
      >
        {reviewStateText(document.reviewState.status)}
      </Text>
      <Text style={styles.ingestedAt}>
        {t('medicalDocument.source.importedAt', {
          date: formatDateTime(new Date(document.ingestedAt)),
        })}
      </Text>
      {document.evidenceSpans.length === 0 ? (
        <Text testID="medical-document-source-empty">
          {t('medicalDocument.source.empty')}
        </Text>
      ) : (
        document.evidenceSpans.map((span, index) => (
          <EvidenceExcerpt key={span.id} span={span} index={index} />
        ))
      )}
    </ScrollView>
  );
}

function EvidenceExcerpt({
  span,
  index,
}: {
  span: EvidenceSpan;
  index: number;
}) {
  return (
    <View style={styles.excerpt}>
      <Text
        style={styles.locator}
        testID={`medical-document-source-locator-${index}`}
      >
        {locatorText(span)}
      </Text>
      <Text
        selectable
        style={styles.text}
        testID={`medical-document-source-text-${index}`}
      >
        {span.text}
      </Text>
    </View>
  );
}

function reviewStateText(status: string): string {
  switch (status) {
    case 'reviewed':
      return t('medicalDocument.source.status.reviewed');
    case 'needs_review':
      return t('medicalDocument.source.status.needsReview');
    default:
      return t('medicalDocument.source.status.unreviewed');
  }
}

function locatorText(span: EvidenceSpan): string {
  if (span.locator?.kind === 'document_range') {
    return t('medicalDocument.source.documentRange', {
      page: span.locator.pageNumber,
      start: span.locator.startOffset + 1,
      end: span.locator.endOffset,
    });
  }
  if (span.locator?.kind === 'text_range') {
    return t('medicalDocument.source.textRange', {
      start: span.locator.startOffset + 1,
      end: span.locator.endOffset,
    });
  }
  if (span.pageNumber !== undefined) {
    return t('medicalDocument.source.page', { page: span.pageNumber });
  }
  return t('medicalDocument.source.noLocator');
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
  container: {
    backgroundColor: appColors.background,
    flexGrow: 1,
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 24,
  },
  backButton: {
    alignSelf: 'flex-start',
    borderColor: appColors.border,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  backText: { color: appColors.primaryText, fontSize: 16, fontWeight: '600' },
  title: { color: appColors.text, fontSize: 26, fontWeight: '700' },
  detailStatus: { color: appColors.secondary, fontSize: 15, lineHeight: 21 },
  ingestedAt: { color: appColors.secondary, fontSize: 13 },
  excerpt: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
    padding: 16,
  },
  locator: { color: appColors.secondary, fontSize: 13, fontWeight: '600' },
  text: { color: appColors.text, fontSize: 16, lineHeight: 24 },
});
