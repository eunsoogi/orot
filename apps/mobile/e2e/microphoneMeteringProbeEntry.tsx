import { useEffect, useRef, useState } from 'react';
import { AppRegistry, Button, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { name as appName } from '../app.json';
import { t } from '../src/i18n';
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
      <Text>{t('probe.microphone.title', { seconds: 25 })}</Text>
      <Text>{t('probe.microphone.notice')}</Text>
      <Button
        title={t(
          consent ? 'probe.microphone.consented' : 'probe.microphone.consent',
        )}
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
        title={t('probe.microphone.start')}
        testID="metering-start"
        disabled={!consent || busy || state?.status !== 'idle'}
        onPress={() => act('start')}
      />
      <Button
        title={t('recording.pause')}
        testID="metering-pause"
        disabled={busy || state?.status !== 'recording'}
        onPress={() => act('pause')}
      />
      <Button
        title={t('probe.microphone.resume')}
        testID="metering-resume"
        disabled={busy || state?.status !== 'paused'}
        onPress={() => act('resume')}
      />
      <Button
        title={t('probe.microphone.finish')}
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
