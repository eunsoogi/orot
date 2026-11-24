import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { t } from '../../i18n';
import {
  article,
  second,
  openReport,
  installReportAppState,
  reportNativeWitness,
} from '../testSupport/generatedReportPublicSourceFixture';
jest.mock('../../generatedReports/readers', () => ({
  ...jest.requireActual('../../generatedReports/readers'),
  openGeneratedReportReader: jest.fn(),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

beforeEach(() => {
  AppState.currentState = 'active';
  jest.clearAllMocks();
  jest
    .mocked(conversationExecutionNative)
    .mockReturnValue(reportNativeWitness().adapter);
});
afterEach(() => jest.restoreAllMocks());

test('Records reopens the exact saved Web item and PMC article only after tapping, without changing the route', async () => {
  const { f, nav, local, resolve, browser } = await openReport();
  try {
    const report = nav.getSnapshot().currentRoute.key;
    expect(local).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(browser).not.toHaveBeenCalled();
    await fireEvent.press(
      screen.getByRole('link', { name: 'Second original' }),
    );
    await waitFor(() => expect(browser).toHaveBeenCalledWith(second));
    expect(browser.mock.calls).toEqual([[second]]);
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: 'public-report',
        sessionId: 'selected',
        sessionVersion: 0,
      }),
      0,
      expect.any(AbortSignal),
    );
    await fireEvent.press(
      screen.getByRole('button', {
        name: t('ragConversation.conversation.moreEvidence', { count: 1 }),
      }),
    );
    expect(screen.queryByText('Mismatched publication')).toBeNull();
    expect(screen.queryByText('Malformed external snapshot')).toBeNull();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Synthetic publication' }),
    );
    await waitFor(() =>
      expect(browser.mock.calls).toEqual([[second], [article]]),
    );
    expect(resolve).toHaveBeenLastCalledWith(
      expect.objectContaining({ turnId: 'public-report' }),
      1,
      expect.any(AbortSignal),
    );
    expect(nav.getSnapshot().currentRoute.key).toBe(report);
    expect(screen.queryByTestId('ai-feature-source-detail')).toBeNull();
  } finally {
    f.close();
  }
});

test('a hidden session cannot open even an already rendered original', async () => {
  const { f, resolve, browser } = await openReport();
  try {
    await f.storage.hideSession('selected', 0);
    await fireEvent.press(screen.getByRole('link', { name: 'First original' }));
    expect(
      await screen.findByText(
        t('ragConversation.conversation.sourceOpenFailed'),
      ),
    ).toBeVisible();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(browser).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

test.each(['native Back', 'deletion'] as const)(
  'losing ownership from %s cancels a resolved URL still held before OS dispatch',
  async event => {
    const { f, nav, resolve, browser } = await openReport();
    const realResolve = resolve.getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>(finish => {
      release = finish;
    });
    let proved = false;
    resolve.mockImplementationOnce(async (...args) => {
      const resolved = await realResolve(...args);
      proved = resolved?.kind === 'external';
      await held;
      return resolved;
    });
    try {
      await fireEvent.press(
        screen.getByRole('link', { name: 'First original' }),
      );
      await waitFor(() => expect(proved).toBe(true));
      const route = nav.getSnapshot().currentRoute.key;
      const signal = resolve.mock.calls[0]?.[2];
      expect(signal?.aborted).toBe(false);
      await act(() => {
        if (event === 'deletion') notifyLocalSourceDeleted();
        else expect(nav.reconcileNativeBack(route)).toBe(true);
        expect(signal?.aborted).toBe(true);
      });
      await act(release);
      expect(browser).not.toHaveBeenCalled();
    } finally {
      release();
      f.close();
    }
  },
);

test('return from an explicit browser trip revalidates the same report and rejects a changed lease', async () => {
  const move = installReportAppState();
  const { f, nav, browser, read } = await openReport();
  try {
    const route = nav.getSnapshot().currentRoute.key;
    const click = () =>
      fireEvent.press(screen.getByRole('link', { name: 'First original' }));
    await click();
    await waitFor(() => expect(browser).toHaveBeenCalledTimes(1));
    await move('background');
    expect(screen.queryByText('Synthetic paragraph 1.')).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    await move('active');
    expect(await screen.findByText('Synthetic paragraph 1.')).toBeVisible();
    expect(read).toHaveBeenCalledTimes(2);
    expect(nav.getSnapshot().currentRoute.key).toBe(route);

    await click();
    await waitFor(() => expect(browser).toHaveBeenCalledTimes(2));
    await move('background');
    const hidden = await f.storage.hideSession('selected', 0);
    expect(await f.storage.undoHiddenSession('selected', hidden!)).toBe(2);
    await move('active');
    expect(await screen.findByText('현재 열 수 없는 자료예요.')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'First original' })).toBeNull();
    expect(browser).toHaveBeenCalledTimes(2);
  } finally {
    f.close();
  }
});
