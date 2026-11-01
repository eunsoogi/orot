import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import SymptomsScreen from '../SymptomsScreen';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

function Fixture() {
  const { host, actions } = useNavigationPrimaryActionHost('symptoms');
  return (
    <NavigationPrimaryActionContext.Provider value={host}>
      <SymptomsScreen
        entries={[]}
        onBack={jest.fn()}
        onRetry={jest.fn()}
        onFilterChange={jest.fn()}
        onCreate={jest.fn()}
        onUpdate={jest.fn()}
        onResolve={jest.fn()}
      />
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

test('moves Add into the dock and replaces it with editor actions without duplicating owners', async () => {
  await render(<Fixture />);
  expect(screen.queryByTestId('symptom-add')).toBeNull();
  await fireEvent.press(screen.getByTestId('dock-add-symptom'));
  expect(screen.queryByTestId('dock-add-symptom')).toBeNull();
  expect(screen.queryByTestId('symptom-save')).toBeNull();
  expect(screen.getByTestId('dock-save-symptom')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('dock-cancel-symptom'));
  expect(screen.getByTestId('dock-add-symptom')).toBeTruthy();
});
