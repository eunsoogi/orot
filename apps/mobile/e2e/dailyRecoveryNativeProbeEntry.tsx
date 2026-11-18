import '../src/agent/polyfills';
import { useEffect, useState } from 'react';
import { AppRegistry, Button, NativeModules, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { name as appName } from '../app.json';
import { openSettingsConsentNativeStore } from './settingsConsentNativeStore';
import { createDailyRecoveryNativeSession } from './dailyRecoveryNativeSession';

/** Isolated acceptance entry: no normal app, provider registration or real credentials. */
function DailyRecoveryNativeEntry() {
  const [session, setSession] = useState<ReturnType<
    typeof createDailyRecoveryNativeSession
  > | null>(null);
  const [status, setStatus] = useState('preparing');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let close: (() => void) | undefined;
    const prepare = async () => {
      const manager = NativeModules.SettingsManager;
      const launch =
        manager?.settings ?? manager?.getConstants?.().settings ?? {};
      if (
        !NativeModules.OrotTestControl ||
        launch.OROT_DAILY_RECOVERY !== 'synthetic' ||
        launch.OROT_TEST_SCENARIO !== 'daily-report-visual'
      )
        throw new Error('Explicit isolated daily recovery test required');
      const phase = launch.OROT_DAILY_RECOVERY_PHASE;
      if (!['create', 'reopen', 'cleanup'].includes(phase))
        throw new Error('Unknown synthetic recovery phase');
      const store = await openSettingsConsentNativeStore(
        launch.OROT_DAILY_RECOVERY_FIXTURE,
        phase === 'create',
      );
      if (phase === 'cleanup') {
        await store.remove();
        if (active) setStatus('cleanup-complete');
        return;
      }
      close = () => store.close();
      if (!active) {
        close();
        return;
      }
      const next = createDailyRecoveryNativeSession(store);
      const result =
        phase === 'create' ? await next.stage() : await next.inspect();
      if (active) {
        setSession(next);
        setStatus(JSON.stringify(result));
      }
    };
    prepare().catch(() => {
      if (active) setStatus('synthetic-preparation-failed');
    });
    return () => {
      active = false;
      close?.();
    };
  }, []);
  const run = async (action: 'resume' | 'cancel' | 'delete' | 'revoke') => {
    if (busy || !session) return;
    setBusy(true);
    try {
      setStatus(
        JSON.stringify(
          action === 'resume'
            ? await session.resume()
            : await session.invalidate(action),
        ),
      );
    } catch {
      setStatus('synthetic-operation-failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaProvider>
      <SafeAreaView>
        <View>
          <Text testID="daily-recovery-native-status">{status}</Text>
          {(['resume', 'cancel', 'delete', 'revoke'] as const).map(action => (
            <Button
              key={action}
              testID={`daily-recovery-native-${action}`}
              title={action}
              disabled={!session || busy}
              onPress={() => {
                run(action);
              }}
            />
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
AppRegistry.registerComponent(appName, () => DailyRecoveryNativeEntry);
