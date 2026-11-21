import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ChatGPTSelectionServices } from '../../../providers/selection/chatGPTServices';
import { AiProviderSelectorRow } from '../AiProviderSelectorRow';
import {
  resolveSelectedAiProvider,
  type ResolveConversationModelDisplay,
} from '../provider';

jest.mock('../../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

test('an inconclusive catalog does not leave a stale unavailable warning when the same model can later resolve', async () => {
  const account = {
    issuedClientID: 'synthetic-account',
    requiresSignIn: false,
    hasDirectPlanAccess: true,
  };
  const model = {
    id: 'chatgpt-plan:synthetic-account:synthetic-model',
    slug: 'synthetic-model',
    displayName: 'Synthetic current model',
  };
  const listModels = jest
    .fn<ReturnType<ChatGPTSelectionServices['listModels']>, [string]>()
    .mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'provider_unavailable',
        message: 'Synthetic offline catalog',
        retryable: true,
        connectivity: 'offline',
      },
    })
    .mockResolvedValue({ ok: true, value: [model] });
  const options = {
    selectionStore: {
      load: async () => ({ providerId: model.id, modelId: model.slug }),
      save: jest.fn(),
      clear: jest.fn(),
    },
    chatGPTServices: {
      listAccounts: async () => [account],
      listModels,
      signIn: jest.fn(),
      signOut: jest.fn(),
      cancelSignIn: jest.fn(),
    },
  };
  const resolve = (display?: Parameters<ResolveConversationModelDisplay>[0]) =>
    resolveSelectedAiProvider(options, display);
  const onPress = jest.fn();
  const view = await render(
    <AiProviderSelectorRow
      onPress={onPress}
      resolveSelectedAi={resolve}
      revision={0}
    />,
  );
  expect(await screen.findByText('모델 설정 열기')).toBeTruthy();
  expect(screen.queryByText('선택한 AI를 확인할 수 없어요.')).toBeNull();
  expect(screen.queryByText(model.displayName)).toBeNull();
  expect(listModels).toHaveBeenCalledTimes(1);

  // This is the same resolver used at send, but an independent admission.
  const sendChoice = await resolveSelectedAiProvider(options);
  expect(sendChoice).toMatchObject({ status: 'ready', modelId: model.slug });
  expect(listModels).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(model.displayName)).toBeNull();
  await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(listModels).toHaveBeenCalledTimes(2);

  await view.rerender(
    <AiProviderSelectorRow
      onPress={onPress}
      resolveSelectedAi={resolve}
      revision={1}
    />,
  );
  expect(await screen.findByText(model.displayName)).toBeTruthy();
  expect(listModels).toHaveBeenCalledTimes(3);
});
