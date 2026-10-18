// Match the shipping entry before loading LangGraph or encrypted storage.
import '../src/agent/polyfills';
import React, { useEffect, useState } from 'react';
import { AppRegistry, Text, View } from 'react-native';
import App from '../App';
import { name as appName } from '../app.json';
import {
  PERFORMANCE_RECORD_COUNT,
  seedPerformanceData,
} from './performanceDataSeed';

/** Explicit Simulator entry: seeds only synthetic local storage, then mounts the shipping app and real providers. */
function PerformanceDataEntry() {
  const [count, setCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string>();
  useEffect(() => {
    let active = true;
    seedPerformanceData(value => {
      if (active) setCount(value);
    })
      .then(() => {
        if (active) setReady(true);
      })
      .catch(error => {
        if (active) setFailure(String(error));
      });
    return () => {
      active = false;
    };
  }, []);
  if (ready) return <App />;
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
          `합성 성능 데이터 준비: ${count.toLocaleString()} / ${PERFORMANCE_RECORD_COUNT.toLocaleString()}`}
      </Text>
    </View>
  );
}

AppRegistry.registerComponent(appName, () => PerformanceDataEntry);
