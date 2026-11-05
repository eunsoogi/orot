import { Pressable, StyleSheet, View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { ConversationSources } from './ConversationSources';
import type { HealthSummaryResult } from './healthSummary';

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
      <AppText>
        {window.fromInclusive} 이상 · {window.toExclusive} 미만 (
        {window.timeZone})
      </AppText>
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
      <AppText>
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
