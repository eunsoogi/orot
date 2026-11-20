import { useEffect, useRef, useState } from 'react';
import { Button, NativeModules, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { openSettingsCredentialNativeFixture } from './settingsCredentialNativeFixture';
import { consentFixtureIdentity } from './settingsConsentNativeStore';
import { createRealtimeSettingsPermission } from '../src/voiceConversation/createRealtimeSettingsPermission';
import { nativeLiveVoice } from '../src/voiceConversation/nativeRealtimeVoice';

type Fixture = Awaited<ReturnType<typeof openSettingsCredentialNativeFixture>>;

/** No App or production account lookup. Exact synthetic native admission precedes
 * storage; the bridge independently rejects malformed opt-in before any live port. */
export function SettingsConsentBoundaryEntry() {
  const fixture = useRef<Fixture | null>(null);
  const lease = useRef<ReturnType<
    typeof createRealtimeSettingsPermission
  > | null>(null);
  const stopping = useRef<Promise<void> | null>(null);
  const busy = useRef(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('preparing');
  const voice = useRef<ReturnType<typeof nativeLiveVoice>>(null);
  useEffect(() => {
    let current = true;
    const prepare = async () => {
      const manager = NativeModules.SettingsManager;
      const launch =
        manager?.settings ?? manager?.getConstants?.().settings ?? {};
      if (
        launch.OROT_TEST_SCENARIO !== 'settings-provider-layout' ||
        launch.OROT_SETTINGS_CONSENT !== 'synthetic' ||
        launch.OROT_SETTINGS_CONSENT_BOUNDARIES !== 'synthetic' ||
        !NativeModules.OrotTestControl ||
        typeof NativeModules.VoiceRealtimeModule?.settingsConsentSnapshot !==
          'function'
      )
        throw new Error('Explicit synthetic boundary host required');
      const name = consentFixtureIdentity(launch.OROT_SETTINGS_CONSENT_FIXTURE);
      const phase = launch.OROT_SETTINGS_CONSENT_PHASE;
      if (!['create', 'reopen', 'cleanup'].includes(phase))
        throw new Error('Unknown phase');
      const opened = await openSettingsCredentialNativeFixture(
        name,
        phase === 'create',
      );
      fixture.current = opened;
      if (!current) {
        opened.close();
        return;
      }
      if (phase === 'cleanup') {
        await opened.remove();
        fixture.current = null;
        if (current) setStatus('synthetic-cleanup-complete');
        return;
      }
      voice.current = nativeLiveVoice();
      if (!voice.current)
        throw new Error('Synthetic native bridge unavailable');
      const result =
        phase === 'create'
          ? await opened.initializeAndApprove()
          : await opened.inspect();
      if (current) {
        setStatus(JSON.stringify(result));
        setReady(true);
      }
    };
    prepare().catch(() => {
      if (current) setStatus('synthetic-boundary-failed');
    });
    return () => {
      current = false;
      lease.current?.stop();
      voice.current?.stop('settings-consent-boundary').catch(() => {});
      fixture.current?.close();
    };
  }, []);
  const action = async (name: string) => {
    if (busy.current || !fixture.current) return;
    busy.current = true;
    try {
      const owner = fixture.current;
      let result: unknown;
      if (name === 'replace') result = await owner.replace();
      else if (name === 'approve') result = await owner.approve();
      else if (name === 'remove') result = await owner.removeCredential();
      else if (name === 'open') {
        lease.current = createRealtimeSettingsPermission(
          owner.authorization(),
          true,
        );
        const allowed = await lease.current.authorize('gpt-live-1.1', () => {
          stopping.current = voice.current!.stop('settings-consent-boundary');
        });
        if (!allowed) throw new Error('Synthetic grant missing');
        await voice.current!.open(
          'settings-consent-boundary',
          'gpt-live-1.1',
          'synthetic-not-a-real-key',
          '',
          false,
          { schema: 1, language: 'auto', voice: 'default' },
          () => lease.current?.current() === true,
        );
        result =
          await NativeModules.VoiceRealtimeModule.settingsConsentSnapshot(
            false,
          );
      } else if (name === 'revoke') {
        await owner.revoke();
        if (!stopping.current)
          throw new Error('Lease did not cancel native call');
        await stopping.current;
        if (lease.current?.current())
          throw new Error('Revoked lease remained current');
        result =
          await NativeModules.VoiceRealtimeModule.settingsConsentSnapshot(true);
      } else result = await owner.inspect();
      setStatus(JSON.stringify(result));
    } catch {
      setStatus('synthetic-boundary-failed');
    } finally {
      busy.current = false;
    }
  };
  return (
    <SafeAreaProvider>
      <SafeAreaView>
        <View>
          <Text testID="settings-boundary-status">{status}</Text>
          {ready &&
            ['inspect', 'replace', 'approve', 'remove', 'open', 'revoke'].map(
              name => (
                <Button
                  key={name}
                  testID={`settings-boundary-${name}`}
                  title={`Synthetic ${name}`}
                  onPress={() => {
                    action(name);
                  }}
                />
              ),
            )}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
