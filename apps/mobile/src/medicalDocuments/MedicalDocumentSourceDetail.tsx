import type { EvidenceSpan } from '@orot/domain';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatDateTime, t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { appColors } from '../layout/appColors';
import type { SavedMedicalDocument } from './medicalDocumentImportService';

interface MedicalDocumentSourceViewProps {
  readonly document: SavedMedicalDocument;
  readonly onBack: () => void;
}

/** Keeps saved metadata and spans in measured regions while the Records scene owns vertical scrolling. */
export function MedicalDocumentSourceView({
  document,
  onBack,
}: MedicalDocumentSourceViewProps) {
  return (
    <AdaptiveColumns
      primary={
        <View
          style={[styles.panel, styles.summaryContent]}
          testID="medical-document-source-view"
        >
          <Pressable
            accessibilityRole="button"
            onPress={onBack}
            style={styles.backButton}
            testID="medical-document-source-back"
          >
            <Text style={styles.backText}>
              {t('medicalDocument.source.back')}
            </Text>
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
          <Text
            style={styles.ingestedAt}
            testID="medical-document-source-imported-at"
          >
            {t('medicalDocument.source.importedAt', {
              date: formatDateTime(new Date(document.ingestedAt)),
            })}
          </Text>
        </View>
      }
      secondary={
        <View
          style={[styles.panel, styles.evidenceContent]}
          testID="medical-document-source-evidence"
        >
          {document.evidenceSpans.length === 0 ? (
            <Text testID="medical-document-source-empty">
              {t('medicalDocument.source.empty')}
            </Text>
          ) : (
            document.evidenceSpans.map((span, index) => (
              <EvidenceExcerpt key={span.id} span={span} index={index} />
            ))
          )}
        </View>
      }
      testID="medical-document-source-detail-layout"
    />
  );
}

/** Renders only persisted extracted text and its locator, without implying original-file access. */
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
        testID={'medical-document-source-locator-' + index}
      >
        {locatorText(span)}
      </Text>
      <Text
        selectable
        style={styles.text}
        testID={'medical-document-source-text-' + index}
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
  panel: {
    minWidth: 0,
    minHeight: 0,
    backgroundColor: appColors.background,
  },
  summaryContent: {
    flexGrow: 1,
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 24,
  },
  evidenceContent: {
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
