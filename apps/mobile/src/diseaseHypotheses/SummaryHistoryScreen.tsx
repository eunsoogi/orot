import { ScrollView, StyleSheet } from 'react-native';
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
  return (
    <ScrollView
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
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: 24,
    gap: 16,
    backgroundColor: appColors.background,
  },
  heading: { fontSize: 26, fontWeight: '700' },
});
