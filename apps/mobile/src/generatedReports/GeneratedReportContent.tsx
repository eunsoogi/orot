import { View } from 'react-native';
import { generatedReportCopy as copy } from './text';
import { HealthSummarySections } from '../ragConversation/HealthSummarySections';
import { readableHypothesis } from '../diseaseHypotheses/readableHypothesis';
import { AppText } from '../layout/AppText';
import { AiResponseText } from '../layout/AiResponseText';
import { OMITTED_SUMMARY_CONTENT_NOTE } from '../diseaseHypotheses/summaryPartialValidation';
import { INCOMPLETE_SUMMARY_EVIDENCE_NOTE } from '../diseaseHypotheses/summaryPartialEvidence';
import type {
  GeneratedReportCitationSelection,
  GeneratedReportDetail,
} from './types';
import { SavedSummaryReviewWarnings } from '../diseaseHypotheses/SavedSummaryReviewWarnings';
import { ConversationReportText } from '../ragConversation/ConversationReportText';
import { ConversationSources } from '../ragConversation/ConversationSources';
import { SavedPossibilityNarrative } from '../ragConversation/SavedPossibilityNarrative';
import { savedPossibilityNarrativeParts } from '../ragConversation/savedPossibilityNarrativeParts';
import { GeneratedVisitQuestions } from './GeneratedVisitQuestions';

const doNotOpenLiveSource = () => {};

/** Preserve every saved narrative field and coverage warning without inventing live evidence links. */
export function GeneratedReportContent({
  detail,
  onOpenCitation,
}: {
  readonly detail: GeneratedReportDetail;
  readonly onOpenCitation?: (
    selection: GeneratedReportCitationSelection,
  ) => void;
}) {
  const sources = detail.conversationSources;
  const report = detail.dailyReport ?? detail.conversationPossibility;
  const summary =
    detail.analysis?.presentation === 'symptom_summary' && detail.analysis;
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
      {report ? (
        <ConversationReportText
          report={report}
          testID="generated-report-conversation-template"
          showTitle={false}
          paragraphTestIDPrefix={
            detail.dailyReport ? 'generated-report-paragraph' : undefined
          }
        />
      ) : summary ? (
        <HealthSummarySections
          sections={summary.hypotheses.map(readableHypothesis)}
          renderSectionTail={section => (
            <AppText>
              {copy.evidenceCounts(
                section.title,
                section.supportingEvidence.length,
                section.contraryEvidence.length,
              )}
            </AppText>
          )}
        />
      ) : detail.visitQuestions ? (
        <GeneratedVisitQuestions questions={detail.visitQuestions} />
      ) : (
        detail.paragraphs.map((text, index) => {
          const id = `generated-report-paragraph-${index}`;
          const parts = detail.savedPossibilityNarrative
            ? savedPossibilityNarrativeParts(text)
            : undefined;
          return parts ? (
            <SavedPossibilityNarrative key={index} testID={id} parts={parts} />
          ) : (
            <AiResponseText key={index} testID={id}>
              {text}
            </AiResponseText>
          );
        })
      )}
      {!summary &&
        detail.analysis?.hypotheses.map((h, index) => (
          <AppText key={index}>
            {copy.evidenceCounts(
              h.title,
              h.supportingEvidence.length,
              h.contraryEvidence.length,
            )}
          </AppText>
        ))}
      {(detail.analysis || detail.dailyReport) && !sources ? (
        <AppText>{copy.sourceNavigationUnavailable}</AppText>
      ) : null}
      {sources && onOpenCitation ? (
        <ConversationSources
          testIDPrefix="generated-report-source"
          references={[]}
          onOpenSource={doNotOpenLiveSource}
          onLinkError={doNotOpenLiveSource}
          archived={{
            citations: sources.citations,
            open: citation =>
              onOpenCitation({
                target: sources.target,
                ordinal: citation.ordinal,
              }),
          }}
        />
      ) : null}
    </View>
  );
}
