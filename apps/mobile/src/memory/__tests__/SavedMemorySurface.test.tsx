import { act, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { appColors } from '../../layout/appColors';
import { SavedMemoryBrowser } from '../SavedMemoryBrowser';

function expectFilledSection() {
  expect(screen.getByTestId('saved-memory-browser')).toHaveStyle({
    backgroundColor: appColors.surface,
    borderWidth: 0,
    borderRadius: 18,
    padding: 16,
  });
}

beforeEach(() => {
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
});

it('retains the filled borderless section while loading and after empty completion', async () => {
  let complete!: (rows: []) => void;
  const load = () =>
    new Promise<[]>(resolve => {
      complete = resolve;
    });
  await render(<SavedMemoryBrowser load={load} />);
  expectFilledSection();
  await act(async () => complete([]));
  expect(screen.getByText('아직 저장된 기억이 없어요.')).toBeTruthy();
  expectFilledSection();
});

it('retains the filled borderless section around read failure and retry', async () => {
  await render(
    <SavedMemoryBrowser
      load={async () => {
        throw new Error('locked');
      }}
    />,
  );
  expect(screen.getByText('다시 시도')).toBeTruthy();
  expectFilledSection();
});
