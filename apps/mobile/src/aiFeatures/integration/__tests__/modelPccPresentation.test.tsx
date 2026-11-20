import { act, render, screen } from '@testing-library/react-native';
import { APPLE_PCC_PROVIDER_ID } from '@orot/provider-apple';
import { t } from '../../../i18n';
import { AppSymbol } from '../../../layout/AppSymbol';
import { providerSelectionStore } from '../../../providers/selection/keychainSelectionStore';
import { APPLE_PCC_MODEL_ID } from '../../../providers/selection/privateCloudCompute';
import type { ProviderSelectionOption } from '../../../providers/selection/types';
import * as execution from '../../../ragConversation/conversationExecutionNative';
import type { ConversationExecutionEvent } from '../../../ragConversation/conversationExecutionLease';
import { AiProviderSelectorRow } from '../AiProviderSelectorRow';
import { resolveSelectedAiProvider } from '../provider';

jest.mock('../../../layout/AppSymbol', () => ({
  AppSymbol: jest.fn(() => null),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { resolve, promise };
}

const name = 'Apple Intelligence';
const saved = {
  providerId: APPLE_PCC_PROVIDER_ID,
  modelId: APPLE_PCC_MODEL_ID,
};
const cases = [
  'ready',
  'denied',
  'different model',
  'selection changed',
  'lock',
  'background before selection',
  'background during verification',
  'initial inactive',
  'different platform on foreground',
] as const;

test.each(cases)(
  'PCC saved label cannot confer readiness: %s',
  async scenario => {
    const selection = deferred<typeof saved>();
    const protection = deferred<boolean>();
    const firstAvailability = deferred<ProviderSelectionOption>();
    const secondAvailability = deferred<ProviderSelectionOption>();
    const read = jest
      .spyOn(providerSelectionStore, 'load')
      .mockReturnValueOnce(selection.promise)
      .mockResolvedValue(
        scenario === 'different platform on foreground'
          ? {
              providerId: 'chatgpt-plan:synthetic-account:synthetic-model',
              modelId: 'synthetic-model',
            }
          : saved,
      );
    let current = true;
    let invalidate = () => {};
    let nativeEvent = (_event: ConversationExecutionEvent) => {};
    const stop = jest.fn();
    jest
      .spyOn(providerSelectionStore, 'liveWitness')
      .mockImplementation(() => () => current);
    jest
      .spyOn(providerSelectionStore, 'subscribeChanges')
      .mockImplementation(listener => {
        invalidate = listener;
        return stop;
      });
    jest.spyOn(execution, 'conversationExecutionNative').mockReturnValue({
      bridgeAvailable: true,
      currentPhase: () =>
        scenario === 'initial inactive' ? 'inactive' : 'active',
      begin: jest.fn(async () => true),
      end: jest.fn(),
      isActive: jest.fn(async () => true),
      protectedDataAvailable: () => protection.promise,
      subscribe(listener) {
        nativeEvent = listener;
        return stop;
      },
    });
    const loadPccOption = jest
      .fn()
      .mockReturnValueOnce(firstAvailability.promise)
      .mockReturnValue(secondAvailability.promise);
    const unrelated = jest.fn(async () => {
      throw new Error('Unrelated provider work');
    });
    const generate = unrelated;
    const option = (allowed: boolean): ProviderSelectionOption => ({
      provider: {
        id: saved.providerId,
        kind: 'language-model',
        displayName: name,
        capabilities: {
          inputTypes: ['text'],
          streaming: true,
          structuredOutput: true,
          toolCalling: true,
        },
        generate,
      },
      modelId: saved.modelId,
      displayName: name,
      privacyBoundary: 'selected-context-remote',
      availability: allowed
        ? { status: 'available' }
        : { status: 'unavailable', message: 'Synthetic approval missing' },
    });

    try {
      const view = await render(
        <AiProviderSelectorRow
          onPress={jest.fn()}
          revision={0}
          resolveSelectedAi={observer =>
            resolveSelectedAiProvider(
              {
                loadPccOption,
                loadAppleOption: unrelated,
                chatGPTServices: {
                  listAccounts: unrelated,
                  listModels: unrelated,
                  signIn: unrelated,
                  signOut: unrelated,
                  cancelSignIn: unrelated,
                },
              },
              observer,
            )
          }
        />,
      );
      const busy = () =>
        screen.getByTestId('ai-feature-select-provider').props
          .accessibilityState.busy;
      const title = () => screen.queryByText(name);
      const emit = (event: ConversationExecutionEvent) =>
        act(async () => nativeEvent(event));
      expect(title()).toBeNull();
      expect(loadPccOption).not.toHaveBeenCalled();
      if (scenario === 'background before selection')
        await emit({ kind: 'phase' });
      await act(async () =>
        selection.resolve(
          scenario === 'different model'
            ? { ...saved, modelId: 'wrong-synthetic-model' }
            : saved,
        ),
      );
      expect(title()).toBeNull();
      expect(loadPccOption).toHaveBeenCalledTimes(1);
      const startedHidden =
        scenario === 'initial inactive' ||
        scenario === 'background before selection';
      if (!startedHidden) {
        await act(async () => protection.resolve(true));
        if (scenario === 'different model') expect(title()).toBeNull();
        else {
          expect(title()).toBeTruthy();
          expect(busy()).toBe(true);
          expect(jest.mocked(AppSymbol).mock.calls.at(-2)?.[0]).toMatchObject({
            name: 'sparkles',
          });
        }
      }
      if (scenario === 'selection changed') {
        await act(async () => {
          current = false;
          invalidate();
        });
        expect(title()).toBeNull();
      }
      if (scenario === 'lock')
        await emit({ kind: 'protectedData', available: false });
      if (
        scenario === 'background during verification' ||
        scenario === 'different platform on foreground'
      )
        await emit({ kind: 'phase' });
      await act(async () =>
        firstAvailability.resolve(option(scenario !== 'denied')),
      );
      const displaced =
        startedHidden ||
        scenario === 'lock' ||
        scenario === 'background during verification' ||
        scenario === 'different platform on foreground';
      if (displaced) {
        expect(title()).toBeNull();
        expect(loadPccOption).toHaveBeenCalledTimes(1);
        if (scenario === 'lock')
          await emit({ kind: 'protectedData', available: true });
        else await emit({ kind: 'foreground' });
        if (startedHidden) await act(async () => protection.resolve(true));
        if (scenario === 'different platform on foreground') {
          expect(loadPccOption).toHaveBeenCalledTimes(1);
          expect(title()).toBeNull();
        } else {
          expect(loadPccOption).toHaveBeenCalledTimes(2);
          expect(title()).toBeTruthy();
          expect(busy()).toBe(true);
          await act(async () => secondAvailability.resolve(option(true)));
        }
      }
      expect(Boolean(title())).toBe(
        scenario === 'ready' ||
          (displaced && scenario !== 'different platform on foreground'),
      );
      expect(busy()).toBe(false);
      if (scenario === 'denied')
        expect(
          screen.getByText(t('provider.selection.rowUnavailable')),
        ).toBeTruthy();
      expect(read).toHaveBeenCalledTimes(displaced ? 2 : 1);
      expect(unrelated).not.toHaveBeenCalled();
      await view.unmount();
      expect(stop).toHaveBeenCalledTimes(displaced ? 3 : 2);
    } finally {
      jest.restoreAllMocks();
    }
  },
);
