import { t } from '../i18n';
import {
  useAiFeatureScreenNavigationState,
  type AiFeatureNavigationStateChange,
} from '../aiFeatures/integration/useAiFeatureNavigationState';
import { useState } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { SavedSummaryHistory } from './SavedSummaryHistory';
import { DiseaseHypothesesScreenOutput } from './DiseaseHypothesesScreenOutput';
import type { SymptomSummaryHistory } from './savedSummaries';
import type { DiseaseHypothesisAnalysis } from './types';

/** Legacy summaries have no verified session mapping: show the original artifact, never invented turns. */
export function ConversationSummaryHistory({
  history,
  onOpenSource,
  navigationRouteKey,
  onNavigationStateChange,
}: {
  readonly navigationRouteKey?: string;
  readonly onNavigationStateChange?: AiFeatureNavigationStateChange;
  readonly history?: SymptomSummaryHistory;
  readonly onOpenSource: (reference: EvidenceReference) => void;
}) {
  useAiFeatureScreenNavigationState(
    navigationRouteKey,
    {
      hasUnsavedChanges: false,
      isRecording: false,
      hasOngoingOperation: false,
    },
    0,
    onNavigationStateChange,
  );
  const inset = useNavigationContentInset();
  const [selected, setSelected] = useState<DiseaseHypothesisAnalysis>();
  return (
    <AdaptiveColumns
      testID="summary-history-columns"
      primary={
        <ScrollView
          testID="summary-history-screen"
          contentContainerStyle={[styles.content, inset]}
        >
          <AppText accessibilityRole="header" style={styles.heading}>
            {t('summaryHistory.conversationTitle')}
          </AppText>
          <AppText accessibilityRole="header">
            {t('summaryHistory.savedPossibilities')}
          </AppText>
          <AppText>{t('summaryHistory.legacyDescription')}</AppText>
          {history ? (
            <SavedSummaryHistory
              history={history}
              current={selected?.savedSummary}
              expanded
              disabled={false}
              onRestore={setSelected}
            />
          ) : (
            <AppText accessibilityRole="alert">
              {t('summaryHistory.unavailable')}
            </AppText>
          )}
          {selected && history ? (
            <View
              testID="conversation-saved-summary-detail"
              style={styles.detail}
            >
              <AppText accessibilityRole="header">
                {t('summaryHistory.selected')}
              </AppText>
              <DiseaseHypothesesScreenOutput
                state={{ status: 'result', value: selected }}
                preview=""
                lastOperation="summary"
                hasSharedCancel
                onCancel={() => {}}
                onOpenSource={onOpenSource}
              />
            </View>
          ) : null}
        </ScrollView>
      }
    />
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: 24,
    gap: 16,
    backgroundColor: appColors.background,
  },
  heading: { fontSize: 34, fontWeight: '700' },
  detail: { gap: 16 },
});
