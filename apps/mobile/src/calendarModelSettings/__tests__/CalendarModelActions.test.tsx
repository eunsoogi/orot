import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, Text, View } from 'react-native';
import { ModelSelectionTabs } from '../../providers/selection/ModelSelectionTabs';
import { createAppleSelectionOption } from '../../providers/selection/options';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { calendarModelStore } from '../calendarModelStore';

// View-only boundary: SQLite grant activation and credential races have dedicated service tests.
jest.mock('../../agent/execution/saveModelSettingsConsent', () => ({
  saveModelSettingsConsent: async (input: {
    store: { save(value: unknown): Promise<void> };
    selection: unknown;
  }) => input.store.save(input.selection),
}));
jest.mock('../calendarModelStore', () => ({
  calendarModelStore: {
    load: jest.fn(async () => null),
    save: jest.fn(async () => {}),
  },
}));
jest.mock('../../voiceSettings/voiceSettingsStore', () => ({
  voiceSettingsStore: {
    accountStatus: jest.fn(async () => ({ connected: false, revision: 1 })),
    subscribe: () => () => {},
  },
}));
const apple = createAppleSelectionOption('available');
function Fixture() {
  const { host, actions } = useNavigationPrimaryActionHost('models');
  return (
    <NavigationPrimaryActionContext.Provider value={host}>
      <ModelSelectionTabs enabled locked={false} calendarOptions={[apple]}>
        <Text>Conversation choices</Text>
      </ModelSelectionTabs>
      <View>
        {actions.map(action => (
          <Button
            key={action.id}
            title={action.label}
            disabled={action.disabled}
            testID={`dock-${action.id}`}
            onPress={() => {
              action.onPress();
            }}
          />
        ))}
      </View>
    </NavigationPrimaryActionContext.Provider>
  );
}

test('calendar confirmation uses the sidebar owner, preserves disclosure, and unregisters after changing tabs', async () => {
  await render(<Fixture />);
  await fireEvent.press(screen.getByTestId('model-tab-calendar'));
  expect(screen.getByTestId('dock-confirm-calendar-model')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('provider-option-0'));
  expect(screen.getByTestId('dock-confirm-calendar-model')).toBeEnabled();
  expect(screen.queryByTestId('provider-selection-confirm')).toBeNull();
  expect(
    screen.getByTestId('provider-selection-confirmation-privacy'),
  ).toBeTruthy();
  expect(calendarModelStore.save).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('dock-cancel-calendar-model'));
  expect(screen.getByTestId('dock-confirm-calendar-model')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('provider-option-0'));
  await fireEvent.press(screen.getByTestId('dock-confirm-calendar-model'));
  expect(calendarModelStore.save).toHaveBeenCalledWith({
    providerId: apple.provider.id,
    modelId: apple.modelId,
  });
  await fireEvent.press(screen.getByTestId('model-tab-language'));
  expect(screen.queryByTestId('dock-confirm-calendar-model')).toBeNull();
  expect(screen.queryByTestId('dock-cancel-calendar-model')).toBeNull();
});
