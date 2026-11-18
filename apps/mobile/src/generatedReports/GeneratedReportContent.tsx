import { View } from 'react-native';
import { generatedReportCopy as copy } from './text';
import { AppText } from '../layout/AppText';
import { AiResponseText } from '../layout/AiResponseText';
import { DailyReportCoverageCard } from '../aiFeatures/integration/DailyReportCoverageCard';
import { OMITTED_SUMMARY_CONTENT_NOTE } from '../diseaseHypotheses/summaryPartialValidation';
import { INCOMPLETE_SUMMARY_EVIDENCE_NOTE } from '../diseaseHypotheses/summaryPartialEvidence';
import type { GeneratedReportDetail } from './types';
import { SavedSummaryReviewWarnings } from '../diseaseHypotheses/SavedSummaryReviewWarnings';

/** Preserve every saved narrative field and coverage warning without inventing live evidence links. */
export function GeneratedReportContent({
  detail,
}: {
  readonly detail: GeneratedReportDetail;
}) {
  return (
    <View testID="generated-report-detail">
      {detail.warning ? <AppText>{detail.warning}</AppText> : null}
      {detail.analysis?.omittedUnsupportedContent ? (
        <AppText>{OMITTED_SUMMARY_CONTENT_NOTE}</AppText>
      ) : null}
      {detail.analysis?.incompleteEvidence ? (
        <AppText>{INCOMPLETE_SUMMARY_EVIDENCE_NOTE}</AppText>
      ) : null}
      <SavedSummaryReviewWarnings current={detail.analysis?.savedSummary} />
      {detail.paragraphs.map((text, index) => (
        <AiResponseText key={index}>{text}</AiResponseText>
      ))}
      {detail.analysis?.hypotheses.map((h, index) => (
        <AppText key={index}>
          {copy.evidenceCounts(
            h.title,
            h.supportingEvidence.length,
            h.contraryEvidence.length,
          )}
        </AppText>
      ))}
      {detail.daily?.coverage.map((item, index) => (
        <DailyReportCoverageCard
          key={index}
          item={item}
          timeZone={detail.daily!.identity.timeZone}
        />
      ))}
      {detail.analysis || detail.daily ? (
        <AppText>{copy.sourceNavigationUnavailable}</AppText>
      ) : null}
    </View>
  );
}
