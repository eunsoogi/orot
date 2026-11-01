import { Alert, Keyboard } from 'react-native';
import { confirmSymptomDiscard } from './confirmSymptomDiscard';
import { navigationText } from '../i18n/navigation';

it('dismisses the keyboard before presenting the draft choices', () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const discard = jest.fn();

  confirmSymptomDiscard(discard);

  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(dismiss.mock.invocationCallOrder[0]).toBeLessThan(
    alert.mock.invocationCallOrder[0]!,
  );
  expect(alert).toHaveBeenCalledWith(
    navigationText.leaveUnsaved.title,
    navigationText.leaveUnsaved.message,
    [
      { text: navigationText.leaveUnsaved.cancel, style: 'cancel' },
      {
        text: navigationText.leaveUnsaved.confirm,
        style: 'destructive',
        onPress: discard,
      },
    ],
  );
  expect(discard).not.toHaveBeenCalled();
  dismiss.mockRestore();
  alert.mockRestore();
});
