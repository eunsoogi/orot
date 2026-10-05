import { ScrollView, StyleSheet, Text } from 'react-native';
import type { TranscriptionProbeReport } from './transcriptionProbe';
import { TranscriptEvidenceProbe } from './transcriptEvidenceProbe';

export default function TranscriptionProbeView({
  report,
}: {
  report: TranscriptionProbeReport;
}) {
  const summary =
    report.outcome === 'measured'
      ? `${report.cases.length} synthetic audio cases measured`
      : report.outcome === 'running'
        ? 'Measuring synthetic audio'
        : `Speech transcription probe ${report.outcome}`;

  return (
    // Keep transcript actions reachable when the probe and evidence card exceed a compact Simulator viewport.
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      testID="transcription-probe-scroll"
    >
      <Text testID="transcription-probe-complete">
        {report.outcome === 'running' ? 'running' : 'complete'}
      </Text>
      {/* Keep the full native report available to Detox without pushing transcript controls below the Simulator screen. */}
      <Text
        accessibilityLabel={JSON.stringify(report)}
        testID="transcription-probe-report"
      >
        {summary}
      </Text>
      {report.outcome === 'measured' ? <TranscriptEvidenceProbe /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
});
