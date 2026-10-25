// Match the shipping entry before loading LangGraph or encrypted storage.
import '../src/agent/polyfills';
import React, { useEffect, useMemo, useState } from 'react';
import { AppRegistry, Button, StyleSheet, Text, View } from 'react-native';
import App from '../App';
import { name as appName } from '../app.json';
import { useInferenceConsent } from '../src/agent/execution/useInferenceConsent';
import { createAiFeatureServices } from '../src/aiFeatures/integration/featureServices';
import { resolveSelectedAiProvider } from '../src/aiFeatures/integration/provider';
import { measurePerformanceEvidence } from './performanceEvidenceProbe';
import { performanceWorkflowDiagnostics } from './performanceWorkflowDiagnostics';
import type { PerformanceWorkflowDiagnostics } from './performanceWorkflowDiagnostics';
import { performanceVisitDiagnostics } from './performanceVisitDiagnostics';
import { probePerformanceVisitEvidence } from './performanceVisitEvidenceProbe';
import {
  PERFORMANCE_RAG_QUESTION,
  runPerformanceRagQuestion,
} from './performanceRagDiagnostics';
import {
  PERFORMANCE_RECORD_COUNT,
  seedPerformanceData,
} from './performanceDataSeed';

interface PerformanceAppHarnessProps {
  readonly diagnostics: PerformanceWorkflowDiagnostics;
  readonly visitDiagnostics: NonNullable<
    React.ComponentProps<typeof App>['renderVisitQuestions']
  >;
  readonly workflowReport: string;
  readonly setWorkflowReport: (value: string) => void;
}

const styles = StyleSheet.create({
  harness: { flex: 1 },
  workflowReport: {
    position: 'absolute',
    top: 50,
    left: 10,
    right: 10,
    color: '#000',
    backgroundColor: '#fff',
    fontSize: 10,
  },
  preparation: {
    flex: 1,
    padding: 30,
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  preparationText: { color: '#111', fontSize: 18 },
});

/** Uses the real selected Apple provider and the screen's service path for a fixed synthetic query. */
function PerformanceAppHarness({
  diagnostics,
  visitDiagnostics,
  workflowReport,
  setWorkflowReport,
}: PerformanceAppHarnessProps) {
  const { consent, disclosureSheet } = useInferenceConsent();
  const services = useMemo(
    () => createAiFeatureServices(consent, diagnostics),
    [consent, diagnostics],
  );
  const [runningRag, setRunningRag] = useState(false);

  async function runRagDiagnostic() {
    if (runningRag) return;
    setRunningRag(true);
    setWorkflowReport(`Submitting ${PERFORMANCE_RAG_QUESTION}`);
    try {
      const selection = await resolveSelectedAiProvider(diagnostics.selectedAi);
      const result = await runPerformanceRagQuestion(
        selection,
        services,
        new AbortController().signal,
      );
      setWorkflowReport(
        JSON.stringify(
          {
            question: PERFORMANCE_RAG_QUESTION,
            trace: diagnostics.getTrace(),
            result,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      setWorkflowReport(
        JSON.stringify({
          status: 'diagnostic_failed',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setRunningRag(false);
    }
  }

  return (
    <View style={styles.harness}>
      <App
        aiFeatureServiceDependencies={diagnostics}
        renderVisitQuestions={visitDiagnostics}
      />
      <Button
        title={runningRag ? '합성 RAG 질문 실행 중' : '합성 RAG 질문 진단'}
        disabled={runningRag}
        onPress={() => {
          runRagDiagnostic();
        }}
      />
      <Button
        title="합성 진료 근거 검사"
        onPress={() => {
          setWorkflowReport('Searching synthetic visit evidence…');
          probePerformanceVisitEvidence().then(setWorkflowReport);
        }}
      />
      {workflowReport ? (
        <Text pointerEvents="none" style={styles.workflowReport}>
          {workflowReport}
        </Text>
      ) : null}
      {disclosureSheet}
    </View>
  );
}

/** Explicit Simulator entry: seeds only synthetic local storage, then mounts the shipping app and real providers. */
function PerformanceDataEntry() {
  const [count, setCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [report, setReport] = useState<string>();
  const [workflowReport, setWorkflowReport] = useState('');
  const diagnostics = useMemo(
    () => performanceWorkflowDiagnostics(setWorkflowReport),
    [],
  );
  const visitDiagnostics = useMemo(
    () => performanceVisitDiagnostics(setWorkflowReport),
    [],
  );
  useEffect(() => {
    let active = true;
    seedPerformanceData(value => {
      if (active) setCount(value);
    })
      .then(async () => {
        const measurement = await measurePerformanceEvidence();
        if (active) setReport(JSON.stringify(measurement, null, 2));
      })
      .catch(error => {
        if (active) setFailure(String(error));
      });
    return () => {
      active = false;
    };
  }, []);
  if (ready)
    return (
      <PerformanceAppHarness
        diagnostics={diagnostics}
        visitDiagnostics={visitDiagnostics}
        workflowReport={workflowReport}
        setWorkflowReport={setWorkflowReport}
      />
    );
  return (
    <View style={styles.preparation}>
      <Text style={styles.preparationText}>
        {failure ??
          report ??
          `합성 성능 데이터 준비: ${count.toLocaleString()} / ${PERFORMANCE_RECORD_COUNT.toLocaleString()}`}
      </Text>
      {report ? (
        <Button title="오롯 열기" onPress={() => setReady(true)} />
      ) : null}
    </View>
  );
}

AppRegistry.registerComponent(appName, () => PerformanceDataEntry);
