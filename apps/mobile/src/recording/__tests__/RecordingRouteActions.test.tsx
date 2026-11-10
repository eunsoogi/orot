import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import RecordingScreenHeader from '../RecordingScreenHeader';
import RecordingLibraryList from '../RecordingLibraryList';
import RecordingLibraryPanel from '../RecordingLibraryPanel';
import { t } from '../../i18n';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

test('offers retry for a failed recording read before showing an empty library', async () => {
  const list = jest
    .fn()
    .mockRejectedValueOnce(new Error('read failed'))
    .mockResolvedValue([]);
  await render(
    <RecordingLibraryPanel service={{ list, deleteRecording: jest.fn() }} />,
  );
  expect(
    await screen.findByText(t('recording.library.loadError')),
  ).toBeTruthy();
  expect(screen.queryByTestId('recording-library-empty')).toBeNull();
  await fireEvent.press(screen.getByTestId('recording-library-retry'));
  expect(await screen.findByTestId('recording-library-empty')).toBeTruthy();
  expect(list).toHaveBeenCalledTimes(2);
});

test('moves recording history and new-recording entry without changing busy guards', async () => {
  const history = jest.fn();
  const create = jest.fn();
  function Fixture({ library, busy }: { library: boolean; busy: boolean }) {
    const { host, actions } = useNavigationPrimaryActionHost('recording');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        {library ? (
          <RecordingLibraryList
            recordings={[]}
            loading={false}
            loadError={false}
            disabled={busy}
            onOpen={jest.fn()}
            onDelete={jest.fn()}
            onNewRecording={create}
          />
        ) : (
          <RecordingScreenHeader
            controlsBusy={busy}
            onOpenSavedRecordings={history}
            sourceRetryPending={false}
            stateReady
            status="idle"
          />
        )}
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
  const view = await render(<Fixture library={false} busy />);
  expect(screen.getByTestId('dock-recording-history')).toBeDisabled();
  await view.rerender(<Fixture library={false} busy={false} />);
  await fireEvent.press(screen.getByTestId('dock-recording-history'));
  expect(history).toHaveBeenCalledTimes(1);
  await view.rerender(<Fixture library busy={false} />);
  await fireEvent.press(screen.getByTestId('dock-new-recording'));
  expect(create).toHaveBeenCalledTimes(1);
});
