// Match the shipping entry before loading LangGraph or encrypted storage.
import '../src/agent/polyfills';
import React, { useEffect, useMemo, useState } from 'react';
import { AppRegistry, Button, Text, View } from 'react-native';
import App from '../App';
import { name as appName } from '../app.json';
import { measurePerformanceEvidence } from './performanceEvidenceProbe';
import { performanceWorkflowDiagnostics } from './performanceWorkflowDiagnostics';
import { performanceVisitDiagnostics } from './performanceVisitDiagnostics';
import { probePerformanceVisitEvidence } from './performanceVisitEvidenceProbe';
import {
  PERFORMANCE_RECORD_COUNT,
  seedPerformanceData,
} from './performanceDataSeed';

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
      <View style={{ flex: 1 }}>
        <App
          aiFeatureServiceDependencies={diagnostics}
          renderVisitQuestions={visitDiagnostics}
        />
        <Button
          title="합성 진료 근거 검사"
          onPress={() => {
            setWorkflowReport('Searching synthetic visit evidence…');
            void probePerformanceVisitEvidence().then(setWorkflowReport);
          }}
        />
        {workflowReport ? (
          <Text
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 50,
              left: 10,
              right: 10,
              color: '#000',
              backgroundColor: '#fff',
              fontSize: 10,
            }}
          >
            {workflowReport}
          </Text>
        ) : null}
      </View>
    );
  return (
    <View
      style={{
        flex: 1,
        padding: 30,
        justifyContent: 'center',
        backgroundColor: '#fff',
      }}
    >
      <Text style={{ color: '#111', fontSize: 18 }}>
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
