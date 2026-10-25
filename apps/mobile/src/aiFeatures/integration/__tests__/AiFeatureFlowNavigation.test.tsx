import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import { navigationText } from '../../../i18n/navigation';
import { AiFeatureRoute } from '../AiFeatureRoute';
import type { ChatGPTSelectionServices } from '../../../providers/selection/chatGPTServices';
import type { ProviderSelectionStore } from '../../../providers/selection/types';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('../../../providers/selection/options', () => {
  const actual = jest.requireActual('../../../providers/selection/options');
  return {
    ...actual,
    loadAppleSelectionOption: jest.fn(async () =>
      actual.createAppleSelectionOption('available'),
    ),
  };
});

describe('AI feature guarded navigation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps a pending provider choice on cancel and pops it only after confirmation', async () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const route = await render(
      <AiFeatureRoute
        onBack={jest.fn()}
        serviceDependencies={{
          selectedAi: {
            selectionStore: makeSelectionStore(),
            chatGPTServices: makeChatGPTServices(),
          },
        }}
      />,
    );

    await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
    await waitFor(() =>
      expect(screen.getByTestId('provider-option-0')).toBeTruthy(),
    );
    await fireEvent.press(screen.getByTestId('provider-option-0'));
    await fireEvent.press(screen.getByTestId('navigation-back'));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));

    await pressAlertButton(alert, 0);
    await waitFor(() =>
      expect(screen.getByTestId('navigation-back')).not.toBeDisabled(),
    );
    expect(screen.getByTestId('provider-selection-screen')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('navigation-back'));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
    await pressAlertButton(alert, 1);
    await waitFor(() =>
      expect(screen.queryByTestId('provider-selection-screen')).toBeNull(),
    );
    expect(screen.getByTestId('ai-feature-screen-content')).toBeTruthy();
    route.unmount();
  });

  it('keeps the route mounted during the non-cancelable selection save', async () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    let finishSave: (() => void) | undefined;
    const selectionStore = makeSelectionStore();
    selectionStore.save = jest.fn(
      () =>
        new Promise<void>(resolve => {
          finishSave = resolve;
        }),
    );
    const route = await render(
      <AiFeatureRoute
        onBack={jest.fn()}
        serviceDependencies={{
          selectedAi: {
            selectionStore,
            chatGPTServices: makeChatGPTServices(),
          },
        }}
      />,
    );

    await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
    await waitFor(() =>
      expect(screen.getByTestId('provider-option-0')).toBeTruthy(),
    );
    await fireEvent.press(screen.getByTestId('provider-option-0'));
    const saveAction = fireEvent.press(
      screen.getByTestId('provider-selection-confirm'),
    );
    await waitFor(() => expect(selectionStore.save).toHaveBeenCalledTimes(1));

    await fireEvent.press(screen.getByTestId('navigation-back'));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(alert.mock.calls[0]?.[0]).toBe('AI 선택을 저장하고 있어요');
    expect(screen.getByTestId('provider-selection-screen')).toBeTruthy();
    await pressAlertButton(alert, 0);

    await act(async () => {
      finishSave?.();
    });
    await saveAction;
    await waitFor(() =>
      expect(screen.queryByTestId('provider-selection-screen')).toBeNull(),
    );
    route.unmount();
  });

  it('confirms before leaving a route that will cancel account sign-in', async () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    let rejectSignIn: (error?: unknown) => void = () => undefined;
    const cancelSignIn = jest.fn(() =>
      rejectSignIn(
        Object.assign(new Error('Sign-in cancelled'), {
          code: 'CHATGPT_AUTH_CANCELLED',
        }),
      ),
    );
    const chatGPTServices = makeChatGPTServices({
      signIn: jest.fn(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectSignIn = reject;
          }),
      ),
      cancelSignIn,
    });
    const route = await render(
      <AiFeatureRoute
        onBack={jest.fn()}
        serviceDependencies={{
          selectedAi: {
            selectionStore: makeSelectionStore(),
            chatGPTServices,
          },
        }}
      />,
    );

    await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
    await waitFor(() =>
      expect(screen.getByTestId('chatgpt-account-action')).toBeTruthy(),
    );
    // The route's existing unmount cleanup cancels this pending operation.
    const signInAction = fireEvent.press(
      screen.getByTestId('chatgpt-account-action'),
    );
    await waitFor(() =>
      expect(chatGPTServices.signIn).toHaveBeenCalledTimes(1),
    );
    await fireEvent.press(screen.getByTestId('navigation-back'));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(alert.mock.calls[0]?.[0]).toBe(
      navigationText.leaveAccountConnection.title,
    );
    expect(alert.mock.calls[0]?.[1]).toBe(
      navigationText.leaveAccountConnection.message,
    );

    await pressAlertButton(alert, 0);
    await waitFor(() =>
      expect(screen.getByTestId('provider-selection-screen')).toBeTruthy(),
    );
    expect(cancelSignIn).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('navigation-back'));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
    await pressAlertButton(alert, 1);
    await waitFor(() =>
      expect(screen.queryByTestId('provider-selection-screen')).toBeNull(),
    );
    expect(cancelSignIn).toHaveBeenCalledTimes(1);
    await signInAction;
    route.unmount();
  });
});

/** Runs the real guard's native confirmation callback in a component test. */
async function pressAlertButton(alert: jest.SpyInstance, index: number) {
  const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const press = buttons?.[index]?.onPress;
  if (!press) throw new Error(`Alert button ${index} was not registered.`);
  await act(async () => {
    press();
    await Promise.resolve();
  });
}

function makeSelectionStore(): ProviderSelectionStore {
  return {
    load: async () => null,
    save: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  };
}

function makeChatGPTServices(
  overrides: Partial<ChatGPTSelectionServices> = {},
): ChatGPTSelectionServices {
  return {
    listAccounts: jest.fn(async () => []),
    listModels: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(),
    cancelSignIn: jest.fn(),
    ...overrides,
  };
}
