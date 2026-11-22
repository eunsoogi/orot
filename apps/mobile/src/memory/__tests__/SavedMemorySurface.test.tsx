import { act, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { appColors } from '../../layout/appColors';
import { SavedMemoryBrowser } from '../SavedMemoryBrowser';

function expectUnfilledLibraryShell() {
  const frame = screen.getByTestId('saved-memory-browser');
  expect(frame).toHaveStyle({ paddingHorizontal: 20, paddingTop: 24 });
  expect(frame).not.toHaveStyle({ backgroundColor: appColors.surface });
  expect(screen.queryByTestId('saved-memory-rows')).toBeNull();
}

beforeEach(() => {
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
});

it('keeps loading and empty states outside a rows-only surface', async () => {
  let complete!: (rows: []) => void;
  const load = () =>
    new Promise<[]>(resolve => {
      complete = resolve;
    });
  await render(<SavedMemoryBrowser load={load} />);
  expectUnfilledLibraryShell();
  await act(async () => complete([]));
  expect(screen.getByText('아직 저장된 기억이 없어요.')).toBeTruthy();
  expectUnfilledLibraryShell();
});

it('keeps read failure and retry outside a rows-only surface', async () => {
  await render(
    <SavedMemoryBrowser
      load={async () => {
        throw new Error('locked');
      }}
    />,
  );
  expect(screen.getByText('다시 시도')).toBeTruthy();
  expectUnfilledLibraryShell();
});
