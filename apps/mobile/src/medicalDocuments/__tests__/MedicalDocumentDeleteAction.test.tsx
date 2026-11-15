import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { MedicalDocumentDeleteAction } from '../MedicalDocumentDeleteAction';
import { deleteMedicalDocument } from '../medicalDocumentDeletion';
jest.mock('../medicalDocumentDeletion', () => ({
  deleteMedicalDocument: jest.fn(),
}));
afterEach(() => jest.restoreAllMocks());
test('requires confirmation, ignores cancel, and claims deletion once', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  let finish!: (result: { cleanupPending: boolean }) => void;
  jest.mocked(deleteMedicalDocument).mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const onDeleted = jest.fn();
  await render(
    <MedicalDocumentDeleteAction
      sourceId="synthetic-photo"
      onDeleted={onDeleted}
      onBusyChange={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByTestId('medical-document-delete'));
  expect(deleteMedicalDocument).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0]![2]!;
  expect(buttons[0]!.style).toBe('cancel');
  expect(buttons[1]!.style).toBe('destructive');
  await act(async () => {
    buttons[1]!.onPress?.();
    buttons[1]!.onPress?.();
  });
  expect(deleteMedicalDocument).toHaveBeenCalledTimes(1);
  expect(deleteMedicalDocument).toHaveBeenCalledWith('synthetic-photo');
  expect(onDeleted).not.toHaveBeenCalled();
  await act(async () => {
    finish({ cleanupPending: false });
  });
  expect(onDeleted).toHaveBeenCalledTimes(1);
});
test('shows failure without leaving detail and ignores confirmation after unmount', async () => {
  jest
    .mocked(deleteMedicalDocument)
    .mockReset()
    .mockRejectedValue(new Error('locked'));
  const alert = jest.spyOn(Alert, 'alert');
  const onDeleted = jest.fn();
  const view = await render(
    <MedicalDocumentDeleteAction
      sourceId="synthetic-file"
      onDeleted={onDeleted}
      onBusyChange={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByTestId('medical-document-delete'));
  await act(async () => {
    alert.mock.calls[0]![2]![1]!.onPress?.();
  });
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(onDeleted).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('medical-document-delete'));
  await view.unmount();
  await act(async () => {
    alert.mock.calls[1]![2]![1]!.onPress?.();
  });
  expect(deleteMedicalDocument).toHaveBeenCalledTimes(1);
});
