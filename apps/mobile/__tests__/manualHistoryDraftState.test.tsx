import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationLeaveStateRegistrationProvider } from '../src/navigation/useNavigationLeaveStateRegistration';
import type { NavigationLeaveStateRegistration } from '../src/navigation/useNavigationLeaveStateRegistration';
import ManualHistoryScreen from '../src/manualHistory/ManualHistoryScreen';
import { createManualHistoryTestRepository } from '../test-support/manualHistoryTestRepository';

describe('ManualHistoryScreen draft state', () => {
  it('preserves a new-entry draft when the form is closed and reopened', async () => {
    const view = await render(
      <ManualHistoryScreen
        onBack={jest.fn()}
        repository={createManualHistoryTestRepository()}
      />,
    );
    await view.findByTestId('manual-history-empty');
    await fireEvent.press(view.getByTestId('manual-history-add'));
    await fireEvent.changeText(
      view.getByTestId('manual-history-title-input'),
      'Synthetic saved draft',
    );
    await fireEvent.changeText(
      view.getByTestId('manual-history-details-input'),
      'Synthetic draft details that remain after closing the form.',
    );
    await fireEvent.press(view.getByTestId('manual-history-form-close'));
    await fireEvent.press(view.getByTestId('manual-history-add'));

    expect(view.getByTestId('manual-history-title-input').props.value).toBe(
      'Synthetic saved draft',
    );
    expect(view.getByTestId('manual-history-details-input').props.value).toBe(
      'Synthetic draft details that remain after closing the form.',
    );
  });

  it('keeps retained drafts behind the navigation leave guard until saved', async () => {
    let source: Parameters<NavigationLeaveStateRegistration>[0] | undefined;
    const registerLeaveState: NavigationLeaveStateRegistration = value => {
      source = value;
      return () => {
        source = undefined;
      };
    };
    const view = await render(
      <NavigationLeaveStateRegistrationProvider
        registerLeaveState={registerLeaveState}
      >
        <ManualHistoryScreen
          onBack={jest.fn()}
          repository={createManualHistoryTestRepository()}
        />
      </NavigationLeaveStateRegistrationProvider>,
    );
    await view.findByTestId('manual-history-empty');
    expect(source?.readState().hasUnsavedChanges).toBe(false);

    await fireEvent.press(view.getByTestId('manual-history-add'));
    await fireEvent.changeText(
      view.getByTestId('manual-history-title-input'),
      'Synthetic leave-guard draft',
    );
    expect(source?.readState().hasUnsavedChanges).toBe(true);
    await fireEvent.press(view.getByTestId('manual-history-form-close'));
    expect(source?.readState()).toMatchObject({
      canLeave: true,
      hasUnsavedChanges: true,
    });

    await fireEvent.press(view.getByTestId('manual-history-add'));
    expect(view.getByTestId('manual-history-title-input').props.value).toBe(
      'Synthetic leave-guard draft',
    );
    await fireEvent.changeText(
      view.getByTestId('manual-history-details-input'),
      'Synthetic details for the guarded draft.',
    );
    await fireEvent.press(view.getByTestId('manual-history-date-unknown'));
    await fireEvent.press(view.getByTestId('manual-history-save'));
    await waitFor(() =>
      expect(source?.readState()).toMatchObject({
        canLeave: true,
        hasUnsavedChanges: false,
      }),
    );
  });

  it('keeps draft values and leave protection after a save error', async () => {
    let source: Parameters<NavigationLeaveStateRegistration>[0] | undefined;
    const registerLeaveState: NavigationLeaveStateRegistration = value => {
      source = value;
      return () => {
        source = undefined;
      };
    };
    const repository = createManualHistoryTestRepository();
    jest
      .spyOn(repository, 'create')
      .mockRejectedValue(new Error('Synthetic storage failure.'));
    const view = await render(
      <NavigationLeaveStateRegistrationProvider
        registerLeaveState={registerLeaveState}
      >
        <ManualHistoryScreen onBack={jest.fn()} repository={repository} />
      </NavigationLeaveStateRegistrationProvider>,
    );
    await view.findByTestId('manual-history-empty');
    await fireEvent.press(view.getByTestId('manual-history-add'));
    await fireEvent.changeText(
      view.getByTestId('manual-history-title-input'),
      'Synthetic storage-failed draft',
    );
    await fireEvent.changeText(
      view.getByTestId('manual-history-details-input'),
      'Synthetic details retained after storage failure.',
    );
    await fireEvent.press(view.getByTestId('manual-history-date-unknown'));
    await fireEvent.press(view.getByTestId('manual-history-save'));

    expect(await view.findByTestId('manual-history-error')).toBeTruthy();
    expect(view.getByTestId('manual-history-title-input').props.value).toBe(
      'Synthetic storage-failed draft',
    );
    expect(source?.readState()).toMatchObject({
      canLeave: true,
      hasUnsavedChanges: true,
    });
  });
});
