import { waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as stock from '../ownedLiveConversationInvocation';
import {
  canonicalLiveCommonRegistration,
  createLiveCommonHealthPort,
} from '../createLiveCommonHealthPort';
import type { LiveCommonConversationPort } from '../liveCommonConversationRun';
import { fixture } from '../testSupport/liveResponsesProtectedFixture';
import { witness } from '../testSupport/fakeLiveCommonNative';

jest.mock('../../voiceSettings/liveConversationToolsAuthorization', () => ({
  liveConversationToolsAuthorization: () => ({
    authorize: () => Promise.resolve('renewal_required'),
  }),
}));

type Input = Parameters<typeof createLiveCommonHealthPort>[0];

test.each([false, true])(
  'native-owned V3 enters the shared Chat binder only with the exact attestation (changed=%s)',
  async changed => {
    const data = await fixture();
    const phase = AppState.currentState;
    AppState.currentState = 'active';
    const actual = stock.bindOwnedLiveConversationInvocation;
    const bound = jest.spyOn(stock, 'bindOwnedLiveConversationInvocation');
    if (changed)
      bound.mockImplementation(input =>
        actual(input)?.map(tool => ({ ...tool, description: 'Changed' })),
      );
    const registration = canonicalLiveCommonRegistration(witness);
    const owner = {
      callId: 'owned-call',
      sessionId: 'native-session',
      delegationId: 'owned-delegation',
      responseId: 'completed-response',
    };
    const call = {
      ...owner,
      challengeId: 'challenge',
      toolCallId: 'function-call',
      name: 'local-health-context',
      args: '{"topics":["measurements"],"days":7}',
    };
    const accepted = jest.fn<
      void,
      Parameters<Parameters<LiveCommonConversationPort['subscribe']>[1]>
    >();
    const native = {
      challenge: (candidate: typeof call) => candidate === call,
      subscribe: jest.fn<
        ReturnType<Input['native']['subscribe']>,
        Parameters<Input['native']['subscribe']>
      >((_id, _registration, acceptsArguments, onBatch) => {
        if (acceptsArguments(call.name, call.args))
          onBatch({ owner, calls: [call] });
        return () => {};
      }),
    } as unknown as Input['native'];
    try {
      const port = createLiveCommonHealthPort({
        native,
        registration,
        settings: {
          kind: 'active',
          commonToolsPolicy: 'common-tools-v3',
          current: () => true,
        } as Input['settings'],
        current: () => true,
        protectedDataAvailable: async () => true,
        openData: () => data.openData(),
      });
      const detach = port.subscribe(owner.callId, accepted);
      try {
        await waitFor(() => expect(bound).toHaveBeenCalledTimes(1));
        if (changed) {
          expect(accepted).not.toHaveBeenCalled();
        } else {
          expect(accepted).toHaveBeenCalledTimes(1);
          expect(
            accepted.mock.calls[0]?.[0].workflow.tools.map(tool => tool.id),
          ).toEqual(['local-health-context']);
        }
      } finally {
        detach();
      }
    } finally {
      AppState.currentState = phase;
      bound.mockRestore();
      data.close();
    }
  },
);
