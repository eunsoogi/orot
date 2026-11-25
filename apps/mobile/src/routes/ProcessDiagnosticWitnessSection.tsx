import { useState } from 'react';
import { Text, View } from 'react-native';
import { appColors } from '../layout/appColors';
import { readProcessDiagnosticWitness } from '../providers/processDiagnosticWitness';
import { SettingsRouteRow } from './SettingsRouteRows';

type Snapshot = Awaited<ReturnType<typeof readProcessDiagnosticWitness>>;

export function ProcessDiagnosticWitnessSection() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [reading, setReading] = useState(false);

  return (
    <View testID="settings-process-diagnostic-witness">
      <SettingsRouteRow
        symbol="waveform.path"
        testID="settings-read-process-diagnostic-witness"
        onPress={() => {
          if (reading) return;
          setReading(true);
          readProcessDiagnosticWitness()
            .then(setSnapshot)
            .finally(() => setReading(false));
        }}
        title="이 실행의 진단 상태 확인"
      />
      {reading ? (
        <Text style={{ color: appColors.secondary }}>진단 상태 확인 중</Text>
      ) : snapshot === null ? (
        <Text style={{ color: appColors.secondary }}>
          진단 상태를 확인할 수 없어요.
        </Text>
      ) : snapshot ? (
        <View accessibilityLiveRegion="polite">
          <Text style={{ color: appColors.secondary }}>
            {snapshot.launch ? '앱 시작 확인' : '앱 시작 확인 안 됨'}
          </Text>
          <Text style={{ color: appColors.secondary }}>
            {snapshot.bridge ? 'JS 연결 확인' : 'JS 연결 확인 안 됨'}
          </Text>
          {snapshot.receipts.map((receipt, index) => (
            <Text key={index} style={{ color: appColors.secondary }}>
              {receipt}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
