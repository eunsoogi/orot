import { useEffect, useRef, useState } from 'react';
import { Button, NativeModules, Text, View } from 'react-native';
import type { createCanonicalSettingsConsentFixture } from './settingsConsentCanonicalHealthFixture';
import {
  runCanonicalSettingsQueueProbe,
  type CanonicalQueueScenario,
} from './settingsConsentCanonicalQueueProbe';

export type CanonicalQueueFixture = {
  identifier: string;
  coordinator: ReturnType<typeof createCanonicalSettingsConsentFixture>;
  owner: () => boolean;
};

/** Explicit separate synthetic controls; this never starts normal voice or an external model. */
export function NativeCanonicalQueueFixtureControls({
  fixture,
}: {
  fixture: CanonicalQueueFixture;
}) {
  const [status, setStatus] = useState('ready');
  const [invocations, setInvocations] = useState(0);
  const [completed, setCompleted] = useState(0);
  const review = useRef<((approved: boolean) => void) | undefined>(undefined);
  const running = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      running.current?.abort();
      review.current?.(false);
    },
    [],
  );
  const execute = async (scenario?: CanonicalQueueScenario) => {
    if (running.current || !fixture.owner()) return;
    const controller = new AbortController();
    running.current = controller;
    const request = {
      signal: controller.signal,
      owner: () => fixture.owner() && running.current === controller,
      unlocked: async () =>
        (await NativeModules.ConversationExecutionModule?.protectedDataAvailable?.()) ===
        true,
    };
    try {
      const ok = scenario
        ? await fixture.coordinator.invoke(request, () => {
            // Count only real calls across the test-only native boundary.
            setInvocations(count => count + 1);
            return runCanonicalSettingsQueueProbe(fixture.identifier, scenario);
          })
        : await fixture.coordinator.approve({
            ...request,
            confirm: () =>
              new Promise<boolean>(resolve => {
                review.current = resolve;
                setStatus('review');
              }),
          });
      if (request.owner())
        setStatus(
          ok
            ? scenario
              ? 'queue-' + scenario + '-passed'
              : 'approved'
            : 'rejected',
        );
    } catch {
      if (request.owner()) setStatus('rejected');
    } finally {
      if (request.owner() && !controller.signal.aborted)
        setCompleted(count => count + 1);
      if (running.current === controller) running.current = undefined;
      review.current = undefined;
    }
  };
  return (
    <View>
      <Text testID="settings-canonical-queue-status">{status}</Text>
      <Text testID="settings-canonical-queue-invocations">{invocations}</Text>
      <Text testID="settings-canonical-queue-completed">{completed}</Text>
      <Button
        testID="settings-canonical-queue-review"
        title="Review synthetic health tool"
        onPress={() => {
          execute();
        }}
      />
      {status === 'review' ? (
        <>
          <Button
            testID="settings-canonical-queue-approve"
            title="Approve synthetic health tool"
            onPress={() => review.current?.(true)}
          />
          <Button
            testID="settings-canonical-queue-deny-review"
            title="Deny synthetic health tool"
            onPress={() => review.current?.(false)}
          />
        </>
      ) : null}
      {(['allow', 'deny', 'replace'] as const).map(scenario => (
        <Button
          key={scenario}
          testID={'settings-canonical-queue-' + scenario}
          title={'Run synthetic ' + scenario}
          onPress={() => {
            execute(scenario);
          }}
        />
      ))}
    </View>
  );
}
