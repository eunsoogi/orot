import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { openAiFeatureLocalData } from '../../aiFeatures/integration/localData';
import { bindCanonicalLiveHealthRun } from '../bindCanonicalLiveHealthRun';
import type { RealtimeToolConfirmationRequest } from '../useRealtimeToolConfirmation';

jest.mock('../canonicalLiveHealthRegistration', () => ({
  canonicalLiveHealthRegistration: () => ({}),
}));
jest.mock('../../aiFeatures/integration/localData', () => ({
  openAiFeatureLocalData: jest.fn(),
}));

test('locking behind the mounted local approval blocks protected storage without a JS lock event', async () => {
  let unlocked = true;
  const openData = jest.mocked(openAiFeatureLocalData);
  const held: { approve?: (approved: boolean) => void } = {};
  const confirm = jest.fn(
    (_request: RealtimeToolConfirmationRequest) =>
      new Promise<boolean>(approve => {
        held.approve = approve;
      }),
  );
  const settle = jest.fn(async () => true);
  const holdDelivery = jest.fn();
  const current = () => true;
  const route = bindCanonicalLiveHealthRun({
    id: 'call',
    owner: current,
    native: {
      canonicalAvailable: true,
      subscribe: () => () => {},
      revoke: async () => {},
      holdDelivery,
      settle,
    },
    protection: {
      bridgeAvailable: true,
      begin: async () => true,
      end: () => {},
      isActive: async () => true,
      subscribe: () => () => {},
      protectedDataAvailable: async () => unlocked,
    },
    selection: {
      binding: {
        version: 2,
        capability: 'canonical-health-context-result-v2',
        grantID: 'companion-model',
        generation: 'companion',
        legacyGeneration: 'legacy',
        credentialEpoch: 'test-account',
        backendModel: 'gpt-6-sol',
      },
      current,
      subscribe: () => () => {},
    },
    confirm,
    revokeCall: jest.fn(),
  });
  expect(route).toBeDefined();
  const mounted = await render(
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        route?.accept({
          callId: 'call',
          sessionId: 'session',
          challengeId: 'challenge',
          toolCallId: 'function',
          responseId: 'response',
          delegationId: 'delegation',
          name: 'local-health-context',
          args: '{"days":3}',
        })
      }
    >
      <Text>Receive synthetic Live request</Text>
    </Pressable>,
  );
  try {
    await fireEvent.press(mounted.getByRole('button'));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0]?.[0]?.use).toBe('live-local-read');
    expect(openData).not.toHaveBeenCalled();
    expect(held.approve).toBeDefined();
    await act(async () => {
      // The OS is already locked, but the JS protected-data event is still held.
      unlocked = false;
      held.approve?.(true);
    });
    await waitFor(() =>
      expect(settle).toHaveBeenCalledWith('call', 'challenge', null),
    );
    expect(openData).not.toHaveBeenCalled();
    expect(holdDelivery).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
  } finally {
    route?.retire();
    await mounted.unmount();
  }
});
