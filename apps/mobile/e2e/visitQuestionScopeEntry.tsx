// Use the production app and selected provider with an opt-in, fail-closed synthetic scope gate.
import '../src/agent/polyfills';
import { useMemo, useState } from 'react';
import { AppRegistry, StyleSheet, Text, View } from 'react-native';
import App from '../App';
import { name as appName } from '../app.json';
import { visitQuestionScopeDiagnostics } from './visitQuestionScopeDiagnostics';

const styles = StyleSheet.create({
  root: { flex: 1 },
  report: { position: 'absolute', top: 45, left: 0, fontSize: 9 },
});

function VisitQuestionScopeEntry() {
  const [report, setReport] = useState('scope not checked');
  const renderVisitQuestions = useMemo(
    () => visitQuestionScopeDiagnostics(setReport),
    [],
  );
  return (
    <View style={styles.root}>
      <App renderVisitQuestions={renderVisitQuestions} />
      <Text
        testID="synthetic-visit-scope"
        pointerEvents="none"
        style={styles.report}
      >
        {report}
      </Text>
    </View>
  );
}

AppRegistry.registerComponent(appName, () => VisitQuestionScopeEntry);
