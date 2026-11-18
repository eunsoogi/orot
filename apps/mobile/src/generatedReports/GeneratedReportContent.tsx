import { View } from 'react-native';
import { AppText } from '../layout/AppText';
import { AiResponseText } from '../layout/AiResponseText';
import { DailyReportCoverageCard } from '../aiFeatures/integration/DailyReportCoverageCard';
import { OMITTED_SUMMARY_CONTENT_NOTE } from '../diseaseHypotheses/summaryPartialValidation';
import { INCOMPLETE_SUMMARY_EVIDENCE_NOTE } from '../diseaseHypotheses/summaryPartialEvidence';
import type { GeneratedReportDetail } from './types';

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
      {detail.paragraphs.map((text, index) => (
        <AiResponseText key={index}>{text}</AiResponseText>
      ))}
      {detail.analysis?.hypotheses.map((h, index) => (
        <AppText
          key={index}
        >{`${h.title}: 뒷받침 근거 ${h.supportingEvidence.length}개 · 반대 근거 ${h.contraryEvidence.length}개`}</AppText>
      ))}
      {detail.daily?.coverage.map((item, index) => (
        <DailyReportCoverageCard
          key={index}
          item={item}
          timeZone={detail.daily!.identity.timeZone}
        />
      ))}
      {detail.analysis || detail.daily ? (
        <AppText>
          이 화면은 저장된 결과를 열람하는 화면이에요. 근거의 원문 링크는
          제공하지 않아요.
        </AppText>
      ) : null}
    </View>
  );
}
