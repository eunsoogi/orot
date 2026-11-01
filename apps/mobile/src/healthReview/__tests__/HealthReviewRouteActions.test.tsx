import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { HealthReviewScreen } from '../HealthReviewScreen';

const mockConsent = { authorize: jest.fn() };
const mockController = {
  refresh: jest.fn(),
  run: jest.fn(),
  cancel: jest.fn(),
  setName: jest.fn(),
  setDraft: jest.fn(),
  delete: jest.fn(),
};
const mockState = {
  busy: false,
  result: { status: 'needs_clarification' },
  error: null,
  requests: [],
  name: '',
  draft: {},
  invocation: null,
};
jest.mock('../HealthReviewSession', () => ({
  useHealthReviewSession: () => ({
    controller: mockController,
    state: mockState,
    consent: mockConsent,
    setCitation: jest.fn(),
  }),
}));
jest.mock('../SafetyForm', () => ({ SafetyForm: () => null }));
jest.mock('../ReviewResult', () => ({ ReviewResult: () => null }));
jest.mock('../../aiFeatures/integration/AiProviderSelectorRow', () => ({
  AiProviderSelectorRow: () => null,
}));

function Fixture() {
  const { host, actions } = useNavigationPrimaryActionHost('review');
  return (
    <NavigationPrimaryActionContext.Provider value={host}>
      <HealthReviewScreen onSource={jest.fn()} onProvider={jest.fn()} />
      <View>
        {actions.map(action => (
          <Button
            key={action.id}
            title={action.label}
            testID={`dock-${action.id}`}
            disabled={action.disabled}
            onPress={() => {
              action.onPress();
            }}
          />
        ))}
      </View>
    </NavigationPrimaryActionContext.Provider>
  );
}

test('forwards fresh and clarification runs with consent and keeps cancel available while busy', async () => {
  const view = await render(<Fixture />);
  expect(screen.queryByTestId('health-review-start')).toBeNull();
  await fireEvent.press(screen.getByTestId('dock-continue-health-review'));
  expect(mockController.run).toHaveBeenCalledWith(mockConsent, true);
  await fireEvent.press(screen.getByTestId('dock-start-health-review'));
  expect(mockController.run).toHaveBeenCalledWith(mockConsent);
  mockState.busy = true;
  await view.rerender(<Fixture />);
  expect(screen.getByTestId('dock-start-health-review')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('dock-cancel-health-review'));
  expect(mockController.cancel).toHaveBeenCalledTimes(1);
  mockState.busy = false;
});
