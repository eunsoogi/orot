import { waitFor } from '@testing-library/react-native';
import { AppState, NativeModules } from 'react-native';
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

test.each(['valid', 'changed', 'deny', 'retire'] as const)(
  'native-owned V3 enters the shared Chat binder only with the exact attestation (%s)',
  async mode => {
    const data = await fixture();
    const phase = AppState.currentState;
    AppState.currentState = 'active';
    const actual = stock.bindOwnedLiveConversationInvocation;
    const bound = jest.spyOn(stock, 'bindOwnedLiveConversationInvocation');
    if (mode === 'changed')
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
    const diagnostic = NativeModules.OrotProviderDiagnostics;
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { enabled: true, report };
    let owns = true;
    let finishProtection!: (available: boolean) => void;
    const nativeProtection = new Promise<boolean>(resolve => {
      finishProtection = resolve;
    });
    const protectedDataAvailable = jest.fn(() => nativeProtection);
    const openData = jest.fn(data.openData);
    try {
      const port = createLiveCommonHealthPort({
        native,
        registration,
        settings: {
          kind: 'active',
          commonToolsPolicy: 'common-tools-v3',
          current: () => true,
        } as Input['settings'],
        current: () => owns,
        toolOwnerCurrent: () => true,
        protectedDataAvailable,
        openData,
      });
      const detach = port.subscribe(owner.callId, accepted);
      try {
        expect(protectedDataAvailable).toHaveBeenCalledTimes(1);
        expect(report).not.toHaveBeenCalled();
        expect(openData).not.toHaveBeenCalled();
        if (mode === 'retire') owns = false;
        finishProtection(mode !== 'deny');
        await nativeProtection;
        if (mode === 'deny' || mode === 'retire') {
          expect(report).not.toHaveBeenCalled();
          expect(openData).not.toHaveBeenCalled();
          expect(bound).not.toHaveBeenCalled();
          expect(accepted).not.toHaveBeenCalled();
          return;
        }
        await waitFor(() => expect(bound).toHaveBeenCalledTimes(1));
        expect(report.mock.calls.map(([, stage]) => stage)).toEqual([
          'owner_reproof',
          'data_open',
        ]);
        if (mode === 'changed') {
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
      NativeModules.OrotProviderDiagnostics = diagnostic;
      AppState.currentState = phase;
      bound.mockRestore();
      data.close();
    }
  },
);
