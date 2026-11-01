import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { DiseaseHypothesesScreen } from '../DiseaseHypothesesScreen';
import type { DiseaseHypothesisRunOutcome } from '../task';

test('cancel allows a new generation before the old request settles without unlocking the new request', async () => {
  const reject: Array<(reason?: unknown) => void> = [];
  const generate = jest.fn(
    () =>
      new Promise<DiseaseHypothesisRunOutcome>((_resolve, rejectPromise) =>
        reject.push(rejectPromise),
      ),
  );
  function Fixture() {
    const { host, actions } = useNavigationPrimaryActionHost('disease');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <DiseaseHypothesesScreen
          onGenerate={generate}
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
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
  await render(<Fixture />);
  await fireEvent.press(screen.getByTestId('dock-generate-hypotheses'));
  expect(generate).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('dock-cancel-hypotheses'));
  await fireEvent.press(screen.getByTestId('dock-generate-hypotheses'));
  expect(generate).toHaveBeenCalledTimes(2);
  await act(async () => {
    reject[0]?.(new Error('old request'));
  });
  expect(screen.getByTestId('dock-generate-hypotheses')).toBeDisabled();
  expect(screen.getByTestId('dock-cancel-hypotheses')).toBeEnabled();
  await fireEvent.press(screen.getByTestId('dock-cancel-hypotheses'));
  await act(async () => {
    reject[1]?.(new Error('new request'));
  });
});
