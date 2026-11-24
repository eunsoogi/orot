import { fireEvent, render, within } from '@testing-library/react-native';
import { t } from '../../i18n';
import * as labels from '../../providers/selection/knownChatGPTModelLabel';
import { OpenAiVoiceToolOptions } from '../OpenAiVoiceToolOptions';

test('unnamed eligible tool rows preserve the selectable raw model ID', async () => {
  const lookup = jest
    .spyOn(labels, 'savedChatGPTModelLabel')
    .mockReturnValue(undefined);
  const choose = jest.fn();
  try {
    const view = await render(
      <OpenAiVoiceToolOptions
        models={['gpt-6-luna']}
        selected={undefined}
        disabled={false}
        choose={choose}
      />,
    );
    const row = view.getByTestId('voice-tool-model-gpt-6-luna');
    expect(
      within(row).getByText(t('modelSettings.modelNameUnknown')),
    ).toBeVisible();
    expect(within(row).getByText('gpt-6-luna')).toBeVisible();
    expect(row.props.accessibilityState).toMatchObject({
      selected: false,
      disabled: false,
    });
    await fireEvent.press(row);
    expect(choose).toHaveBeenCalledWith('gpt-6-luna');
  } finally {
    lookup.mockRestore();
  }
});
