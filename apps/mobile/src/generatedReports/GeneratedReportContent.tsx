import { View } from 'react-native';
import { generatedReportCopy as copy } from './text';
import { AppText } from '../layout/AppText';
import { AiResponseText } from '../layout/AiResponseText';
import { DailyReportCoverageCard } from '../aiFeatures/integration/DailyReportCoverageCard';
import { OMITTED_SUMMARY_CONTENT_NOTE } from '../diseaseHypotheses/summaryPartialValidation';
import { INCOMPLETE_SUMMARY_EVIDENCE_NOTE } from '../diseaseHypotheses/summaryPartialEvidence';
import type {
  GeneratedReportCitationSelection,
  GeneratedReportDetail,
} from './types';
import { SavedSummaryReviewWarnings } from '../diseaseHypotheses/SavedSummaryReviewWarnings';
import { ConversationReportText } from '../ragConversation/ConversationReportText';
import { ConversationSources } from '../ragConversation/ConversationSources';
import type { SavedArchivedCitation } from '../ragConversation/savedArchivedCitations';

const doNotOpenLiveSource = () => {};

/** Preserve every saved narrative field and coverage warning without inventing live evidence links. */
export function GeneratedReportContent({
  detail,
  onOpenCitation,
}: {
  readonly detail: GeneratedReportDetail;
  readonly onOpenCitation?: (
    selection: GeneratedReportCitationSelection,
    citation: SavedArchivedCitation,
  ) => void;
}) {
  const sources = detail.conversationSources;
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
      {detail.conversationPossibility ? (
        <ConversationReportText
          report={detail.conversationPossibility}
          testID="generated-report-conversation-template"
          showTitle={false}
        />
      ) : (
        detail.paragraphs.map((text, index) => (
          <AiResponseText
            key={index}
            testID={`generated-report-paragraph-${index}`}
          >
            {text}
          </AiResponseText>
        ))
      )}
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
      {sources && onOpenCitation ? (
        <ConversationSources
          testIDPrefix="generated-report-source"
          references={[]}
          onOpenSource={doNotOpenLiveSource}
          onLinkError={doNotOpenLiveSource}
          archived={{
            citations: sources.citations,
            open: citation =>
              onOpenCitation(
                { target: sources.target, ordinal: citation.ordinal },
                citation,
              ),
          }}
        />
      ) : null}
    </View>
  );
}
