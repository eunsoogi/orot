import { Pressable, StyleSheet, View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { ConversationSources } from './ConversationSources';
import type { HealthSummaryResult } from './healthSummary';
import { OMITTED_SUMMARY_CONTENT_NOTE } from '../diseaseHypotheses/summaryPartialValidation';
import { INCOMPLETE_SUMMARY_EVIDENCE_NOTE } from '../diseaseHypotheses/summaryPartialEvidence';

/** Show only the validated sections and their original source links. */
export function HealthSummaryCard({
  result,
  onOpenSource,
  onLinkError,
  onRetry,
  showCitations = true,
}: {
  result: HealthSummaryResult;
  onOpenSource: (reference: EvidenceReference) => void;
  onLinkError: () => void;
  onRetry?: () => void;
  showCitations?: boolean;
}) {
  const { window } = result.reference;
  const saved = result.analysis.savedSummary;
  return (
    <View style={styles.card} testID="health-summary-card">
      <AppText style={styles.title}>건강 기록 요약</AppText>
      <AppText testID="health-summary-period">
        {window.fromInclusive} 이상 · {window.toExclusive} 미만 (
        {window.timeZone})
      </AppText>
      {result.analysis.omittedUnsupportedContent ? (
        <AppText accessibilityRole="alert" testID="health-summary-omitted">
          {OMITTED_SUMMARY_CONTENT_NOTE}
        </AppText>
      ) : null}
      {result.analysis.incompleteEvidence ? (
        <AppText accessibilityRole="alert" testID="health-summary-incomplete">
          {INCOMPLETE_SUMMARY_EVIDENCE_NOTE}
        </AppText>
      ) : null}
      {saved?.status === 'saved'
        ? saved.contentReviewIssues?.map(issue => (
            <AppText key={issue} accessibilityRole="alert">
              {issue === 'prescription'
                ? '이 요약의 처방 여부 표현은 다시 확인이 필요해요. 약의 일정 등록만으로 처방 여부를 알 수는 없어요.'
                : issue === 'sleep_count'
                  ? '이 요약의 수면 횟수 표현은 다시 확인이 필요해요. 수면 단계 값은 횟수가 아니에요.'
                  : issue === 'sleep_duration'
                    ? '이 요약의 수면 구간 길이는 원문과 맞지 않을 수 있어요. 원문의 시작·종료 시각을 확인해 주세요.'
                    : '이 요약의 걸음 수 단위는 다시 확인이 필요해요. 걸음 수를 횟수로 읽지 않도록 원문을 확인해 주세요.'}
            </AppText>
          ))
        : null}
      {result.analysis.hypotheses.map((section, index) => (
        <View key={index} style={styles.section}>
          <AppText style={styles.title}>{section.title}</AppText>
          <AppText>{section.summary}</AppText>
          {section.uncertainty ? (
            <AppText>{section.uncertainty}</AppText>
          ) : null}
          {section.missingData.map((missing, item) => (
            <AppText key={item}>{missing}</AppText>
          ))}
          {showCitations ? (
            <ConversationSources
              references={[
                ...section.supportingEvidence,
                ...section.contraryEvidence,
              ]}
              onOpenSource={onOpenSource}
              onLinkError={onLinkError}
            />
          ) : null}
        </View>
      ))}
      <AppText testID="health-summary-save-status">
        {saved?.status === 'saved'
          ? saved.sourceChanged
            ? '원본이 변경된 이전 요약'
            : '저장됨'
          : saved?.status === 'source_unavailable'
            ? '원본을 확인하지 못해 저장하지 못했어요.'
            : saved?.status === 'failed'
              ? '저장하지 못했어요.'
              : '저장 상태를 확인할 수 없어요.'}
      </AppText>
      {saved && saved.status !== 'saved' && onRetry ? (
        <Pressable
          accessibilityRole="button"
          testID="health-summary-retry"
          onPress={onRetry}
          style={styles.retry}
        >
          <AppText>저장 다시 시도</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: appColors.surface,
    gap: 8,
  },
  title: { fontWeight: '600' },
  section: { gap: 6 },
  retry: { minHeight: 44, justifyContent: 'center' },
});
