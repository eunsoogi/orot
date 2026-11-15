import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import ProviderSelectionScreen from '../ProviderSelectionScreen';
import { createAppleSelectionOption } from '../options';
import { providerSelectionText } from '../text';

jest.mock('../../../voiceSettings/VoiceSettingsPanel', () => ({
  VoiceSettingsPanel: () => {
    const { Text } = require('react-native');
    return <Text testID="synthetic-voice-panel">Voice choices</Text>;
  },
}));
const apple = createAppleSelectionOption('available');
const saved = {
  providerId: 'chatgpt-plan:synthetic',
  modelId: 'gpt-synthetic',
};
const store = () => ({
  load: async () => saved,
  save: jest.fn(),
  clear: jest.fn(),
});
const requirements = { inputTypes: ['text'] as const };

it('shows saved identity before catalog refresh without asserting availability', async () => {
  const storage = store();
  await render(
    <ProviderSelectionScreen
      presentation="settings-provider"
      options={[apple]}
      requirements={requirements}
      selectionStore={storage}
    />,
  );
  expect(screen.getByTestId('provider-selection-current')).toHaveTextContent(
    /gpt-synthetic/,
  );
  expect(screen.getByTestId('provider-selection-current')).toHaveTextContent(
    new RegExp(providerSelectionText.unavailableSelection),
  );
  expect(storage.save).not.toHaveBeenCalled();
});
it('switches accessible tabs and removes the hidden language action surface', async () => {
  await render(
    <ProviderSelectionScreen
      presentation="settings-provider"
      options={[apple]}
      requirements={requirements}
      selectionStore={store()}
    />,
  );
  expect(screen.queryByTestId('synthetic-voice-panel')).toBeNull();
  await fireEvent.press(screen.getByTestId('model-tab-voice'));
  expect(
    screen.getByTestId('model-tab-voice').props.accessibilityState.selected,
  ).toBe(true);
  expect(screen.getByTestId('synthetic-voice-panel')).toBeTruthy();
  expect(screen.queryByTestId('provider-selection-footer')).toBeNull();
  await fireEvent.press(screen.getByTestId('model-tab-language'));
  expect(screen.getByTestId('provider-selection-current')).toHaveTextContent(
    /gpt-synthetic/,
  );
  expect(screen.queryByTestId('synthetic-voice-panel')).toBeNull();
});
it('keeps pending confirmation visible and uses neutral card styling', async () => {
  const storage = store();
  await render(
    <ProviderSelectionScreen
      presentation="settings-provider"
      options={[apple]}
      requirements={requirements}
      selectionStore={storage}
    />,
  );
  const card = screen.getByTestId('provider-option-0');
  const before = StyleSheet.flatten(card.props.style);
  await fireEvent.press(card);
  expect(
    StyleSheet.flatten(screen.getByTestId('provider-option-0').props.style),
  ).toEqual(before);
  expect(
    screen.getByTestId('provider-option-0').props.accessibilityState.selected,
  ).toBe(true);
  expect(screen.getByTestId('model-tab-voice')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('model-tab-voice'));
  expect(screen.getByTestId('provider-selection-confirm')).toBeTruthy();
  expect(storage.save).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('provider-selection-cancel'));
  expect(screen.getByTestId('model-tab-voice')).toBeEnabled();
});
