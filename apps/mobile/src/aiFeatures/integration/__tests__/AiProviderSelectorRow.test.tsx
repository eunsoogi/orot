import type { LanguageModelProvider } from '@orot/model-runtime';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ProviderSelectionOption } from '../../../providers/selection/types';
import { AiProviderSelectorRow } from '../AiProviderSelectorRow';
import type { SelectedAiResolution } from '../provider';

jest.mock('../../../layout/AppSymbol', () => ({
  AppSymbol: ({ name }: { name: string }) =>
    require('react').createElement(require('react-native').View, {
      testID: `symbol-${name}`,
    }),
}));

function readySelection(displayName: string): SelectedAiResolution {
  return {
    status: 'ready',
    selection: { providerId: 'selected-provider', modelId: 'selected-model' },
    option: { displayName } as ProviderSelectionOption,
    provider: {} as LanguageModelProvider,
    modelId: 'selected-model',
    recipient: 'selected account',
    remoteProcessing: true,
  };
}

test('shows the actual selected model and keeps the selector accessible', async () => {
  const onPress = jest.fn();
  await render(
    <AiProviderSelectorRow
      onPress={onPress}
      resolveSelectedAi={async () => readySelection('GPT model')}
      revision={0}
    />,
  );

  expect(await screen.findByText('GPT model')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: '사용할 AI, GPT model' }),
  ).toBeTruthy();
  expect(screen.getByTestId('symbol-sparkles')).toBeTruthy();
  expect(screen.getByTestId('symbol-chevron.right')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('prompts only when no AI is selected and keeps unavailable state explicit', async () => {
  const resolveSelectedAi = jest
    .fn<Promise<SelectedAiResolution>, []>()
    .mockResolvedValueOnce({ status: 'selection-required' })
    .mockResolvedValueOnce({ status: 'unavailable' });
  const view = await render(
    <AiProviderSelectorRow
      onPress={jest.fn()}
      resolveSelectedAi={resolveSelectedAi}
      revision={0}
    />,
  );

  expect(await screen.findByText('AI 선택하기')).toBeTruthy();
  await view.rerender(
    <AiProviderSelectorRow
      onPress={jest.fn()}
      resolveSelectedAi={resolveSelectedAi}
      revision={1}
    />,
  );
  expect(await screen.findByText('선택한 AI를 확인할 수 없어요.')).toBeTruthy();
});
