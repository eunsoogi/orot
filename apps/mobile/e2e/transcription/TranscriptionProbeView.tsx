import { StyleSheet, Text, View } from 'react-native';
import type { TranscriptionProbeReport } from './transcriptionProbe';

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
    // Keep this entry limited to provider output; deletion UI runs in transcript-only mode.
    <View style={styles.container}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
});
