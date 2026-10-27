import { ScrollView, StyleSheet } from 'react-native';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { SavedSummaryHistory } from './SavedSummaryHistory';
import type { SymptomSummaryHistory } from './savedSummaries';
import type { DiseaseHypothesisAnalysis } from './types';

/** A separate stack destination keeps history browsing out of the retained summary form. */
export function SummaryHistoryScreen({
  history,
  onRestore,
}: {
  readonly history: SymptomSummaryHistory;
  readonly onRestore: (value: DiseaseHypothesisAnalysis) => void;
}) {
  const inset = useNavigationContentInset();
  // Keep saved summaries in one measured region; selection restores the originating screen,
  // which retains the saved content and provenance.
  return (
    <AdaptiveColumns
      primary={
        <ScrollView
          style={styles.scroll}
          testID="summary-history-screen"
          contentContainerStyle={[styles.content, inset]}
        >
          <AppText accessibilityRole="header" style={styles.heading}>
            저장된 요약
          </AppText>
          <SavedSummaryHistory
            history={history}
            expanded
            disabled={false}
            onRestore={onRestore}
          />
        </ScrollView>
      }
      testID="summary-history-columns"
    />
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    flexGrow: 1,
    padding: 24,
    gap: 16,
    backgroundColor: appColors.background,
  },
  heading: { fontSize: 26, fontWeight: '700' },
});
