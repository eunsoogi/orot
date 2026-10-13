import { useEffect, useRef, useState } from 'react';
import { AppRegistry, Button, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { name as appName } from '../app.json';
import RecordingWaveform from '../src/recording/RecordingWaveform';
import {
  addMeterSample,
  emptyMeterStats,
  meteringProbeModule,
  subscribeMetering,
  type MeteringState,
} from './microphoneMeteringProbeSupport';

/** Dedicated microphone-only entry: it imports no persistence, recording-save, or transcription service. */
function Probe() {
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<MeteringState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const phase = useRef<'initial' | 'resumed'>('initial');
  const phaseStartMs = useRef(0);
  const lastTick = useRef(-1);
  const [statistics, setStatistics] = useState({
    warmup: emptyMeterStats(),
    initial: emptyMeterStats(),
    resumed: emptyMeterStats(),
    pausedEvents: 0,
    pausedNonzero: 0,
  });
  useEffect(() => {
    try {
      const unsubscribe = subscribeMetering(next => {
        setState(next);
        if (next.status === 'paused') {
          setStatistics(previous => ({
            ...previous,
            pausedEvents: previous.pausedEvents + 1,
            pausedNonzero:
              previous.pausedNonzero + (next.amplitude !== 0 ? 1 : 0),
          }));
        }
        if (next.status !== 'recording' || next.ticks === lastTick.current)
          return;
        lastTick.current = next.ticks;
        // Exclude the first 500 ms of each active phase from the stable microphone statistics.
        const key =
          next.durationMs - phaseStartMs.current < 500
            ? 'warmup'
            : phase.current;
        setStatistics(previous => ({
          ...previous,
          [key]: addMeterSample(previous[key], next.amplitude),
        }));
      });
      meteringProbeModule()
        .getState()
        .then(setState, failure => setError(String(failure)));
      return unsubscribe;
    } catch (failure) {
      setError(String(failure));
      return undefined;
    }
  }, []);
  async function act(action: 'start' | 'pause' | 'resume' | 'finish') {
    setBusy(true);
    try {
      const module = meteringProbeModule();
      if (action === 'resume') {
        phase.current = 'resumed';
        phaseStartMs.current = state?.durationMs ?? 0;
      }
      setState(
        await (action === 'start' ? module.start(consent) : module[action]()),
      );
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  }
  const report = JSON.stringify({ state, statistics });
  return (
    <SafeAreaView style={styles.screen}>
      <Text>실제 마이크 진단 (최대 25초)</Text>
      <Text>
        오디오는 저장하거나 전사하지 않습니다. 시작 전 마이크 사용에 동의하세요.
      </Text>
      <Button
        title={consent ? '마이크 사용 동의함' : '마이크 사용 동의'}
        testID="metering-consent"
        disabled={state?.status !== 'idle'}
        onPress={() => setConsent(!consent)}
      />
      <Text testID="metering-status">{state?.status ?? 'unavailable'}</Text>
      <View style={styles.waveform}>
        <RecordingWaveform
          status={
            state?.status === 'permission' ? 'idle' : (state?.status ?? 'idle')
          }
          durationMs={state?.durationMs ?? 0}
          amplitude={state?.amplitude ?? 0}
        />
      </View>
      <Button
        title="시작"
        testID="metering-start"
        disabled={!consent || busy || state?.status !== 'idle'}
        onPress={() => act('start')}
      />
      <Button
        title="일시 정지"
        testID="metering-pause"
        disabled={busy || state?.status !== 'recording'}
        onPress={() => act('pause')}
      />
      <Button
        title="재개"
        testID="metering-resume"
        disabled={busy || state?.status !== 'paused'}
        onPress={() => act('resume')}
      />
      <Button
        title="종료 및 정리"
        testID="metering-finish"
        disabled={
          busy || !['recording', 'paused'].includes(state?.status ?? '')
        }
        onPress={() => act('finish')}
      />
      <Text testID="metering-report" accessibilityLabel={report}>
        {report}
      </Text>
      <Text testID="metering-error">{error}</Text>
    </SafeAreaView>
  );
}
function Entry() {
  return (
    <SafeAreaProvider>
      <Probe />
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  waveform: { height: 80 },
});
AppRegistry.registerComponent(appName, () => Entry);
