import { useId } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { ConversationSources } from './ConversationSources';
import type { HealthSummaryResult } from './healthSummary';
import { OMITTED_SUMMARY_CONTENT_NOTE } from '../diseaseHypotheses/summaryPartialValidation';
import { INCOMPLETE_SUMMARY_EVIDENCE_NOTE } from '../diseaseHypotheses/summaryPartialEvidence';
import { t } from '../i18n';

/** Show only the validated sections and their original source links. */
export function HealthSummaryCard({
  result,
  testIDPrefix,
  onOpenSource,
  onLinkError,
  onRetry,
  showCitations = true,
}: {
  result: HealthSummaryResult;
  testIDPrefix?: string;
  onOpenSource: (reference: EvidenceReference) => void;
  onLinkError: () => void;
  onRetry?: () => void;
  showCitations?: boolean;
}) {
  const instanceId = useId();
  const identity = testIDPrefix ?? `health-summary-${instanceId}`;
  const { window } = result.reference;
  const saved = result.analysis.savedSummary;
  return (
    <View style={styles.card} testID="health-summary-card">
      <AppText style={styles.title}>
        {t('ragConversation.conversation.healthSummary.title')}
      </AppText>
      <AppText testID="health-summary-period">
        {t('ragConversation.conversation.healthSummary.dateRange', {
          from: window.fromInclusive,
          to: window.toExclusive,
          timeZone: window.timeZone,
        })}
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
                ? t(
                    'ragConversation.conversation.healthSummary.prescriptionReview',
                  )
                : issue === 'sleep_count'
                  ? t(
                      'ragConversation.conversation.healthSummary.sleepCountReview',
                    )
                  : issue === 'sleep_duration'
                    ? t(
                        'ragConversation.conversation.healthSummary.sleepDurationReview',
                      )
                    : t(
                        'ragConversation.conversation.healthSummary.stepCountReview',
                      )}
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
              testIDPrefix={`${identity}-section-${index}`}
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
            ? t('ragConversation.conversation.healthSummary.sourceChanged')
            : t('ragConversation.conversation.healthSummary.saved')
          : saved?.status === 'source_unavailable'
            ? t('ragConversation.conversation.healthSummary.sourceUnavailable')
            : saved?.status === 'failed'
              ? t('ragConversation.conversation.healthSummary.saveFailed')
              : t(
                  'ragConversation.conversation.healthSummary.saveStatusUnknown',
                )}
      </AppText>
      {saved && saved.status !== 'saved' && onRetry ? (
        <Pressable
          accessibilityRole="button"
          testID="health-summary-retry"
          onPress={onRetry}
          style={styles.retry}
        >
          <AppText>
            {t('ragConversation.conversation.healthSummary.retrySave')}
          </AppText>
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
