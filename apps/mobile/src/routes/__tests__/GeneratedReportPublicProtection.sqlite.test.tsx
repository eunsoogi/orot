import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import {
  openReport,
  installReportAppState,
  reportNativeWitness,
} from '../testSupport/generatedReportPublicSourceFixture';

jest.mock('../../generatedReports/readers', () => ({
  ...jest.requireActual('../../generatedReports/readers'),
  openGeneratedReportReader: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

beforeEach(() => {
  AppState.currentState = 'active';
  jest.clearAllMocks();
});
afterEach(() => jest.restoreAllMocks());
const click = () =>
  fireEvent.press(screen.getByRole('link', { name: 'First original' }));
const unavailable = '현재 열 수 없는 자료예요.';

test.each([true, false])(
  'a native lock (event=%s) cancels a held verified citation without a JS phase change',
  async emit => {
    const native = reportNativeWitness();
    jest.mocked(conversationExecutionNative).mockReturnValue(native.adapter);
    const { f, resolve, browser } = await openReport();
    const realResolve = resolve.getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>(finish => {
      release = finish;
    });
    let proved = false;
    resolve.mockImplementationOnce(async (...args) => {
      const selected = await realResolve(...args);
      proved = selected?.kind === 'external';
      await held;
      return selected;
    });
    try {
      await click();
      await waitFor(() => expect(proved).toBe(true));
      const signal = resolve.mock.calls[0]?.[2];
      expect(AppState.currentState).toBe('active');
      await act(() => {
        native.set(false, emit);
        if (emit) expect(signal?.aborted).toBe(true);
      });
      await act(release);
      expect(await screen.findByText(unavailable)).toBeVisible();
      expect(browser).not.toHaveBeenCalled();
    } finally {
      release();
      f.close();
    }
  },
);

test('the browser return remains unavailable when protected data is still locked despite JS foreground', async () => {
  const move = installReportAppState();
  const native = reportNativeWitness();
  jest.mocked(conversationExecutionNative).mockReturnValue(native.adapter);
  const { f, browser, read } = await openReport();
  try {
    await click();
    await waitFor(() => expect(browser).toHaveBeenCalledTimes(1));
    await move('background');
    native.set(false);
    await move('active');
    expect(await screen.findByText(unavailable)).toBeVisible();
    expect(read).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Synthetic paragraph 1.')).toBeNull();
  } finally {
    f.close();
  }
});

test('a successful link with no prompt departure does not grant an unrelated later foreground refresh', async () => {
  const move = installReportAppState();
  const native = reportNativeWitness();
  const instant = jest
    .spyOn(globalThis.performance, 'now')
    .mockReturnValue(100);
  jest.mocked(conversationExecutionNative).mockReturnValue(native.adapter);
  const { f, browser, read } = await openReport();
  try {
    await click();
    await waitFor(() => expect(browser).toHaveBeenCalledTimes(1));
    instant.mockReturnValue(1_000_000);
    await move('background');
    await move('active');
    expect(await screen.findByText(unavailable)).toBeVisible();
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    f.close();
  }
});

test.each([true, false])(
  'a native lock (event=%s) also rejects a held browser-return read after active',
  async emit => {
    const move = installReportAppState();
    const native = reportNativeWitness();
    jest.mocked(conversationExecutionNative).mockReturnValue(native.adapter);
    const { f, browser, read } = await openReport();
    const original = read.getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>(finish => {
      release = finish;
    });
    let captured = false;
    read.mockImplementationOnce(async (...args) => {
      const value = await original(...args);
      captured = Boolean(value);
      await held;
      return value;
    });
    try {
      await click();
      await waitFor(() => expect(browser).toHaveBeenCalledTimes(1));
      await move('background');
      await move('active');
      await waitFor(() => expect(captured).toBe(true));
      const signal = read.mock.calls[1]?.[1];
      expect(signal?.aborted).toBe(false);
      await act(() => {
        native.set(false, emit);
        if (emit) expect(signal?.aborted).toBe(true);
      });
      await act(release);
      expect(await screen.findByText(unavailable)).toBeVisible();
      expect(screen.queryByText('Synthetic paragraph 1.')).toBeNull();
      expect(browser).toHaveBeenCalledTimes(1);
    } finally {
      release();
      f.close();
    }
  },
);

test('no native bridge cannot authorize a browser handoff', async () => {
  jest.mocked(conversationExecutionNative).mockReturnValue(null);
  const { f, resolve, browser } = await openReport();
  try {
    await click();
    expect(await screen.findByText(unavailable)).toBeVisible();
    expect(resolve).not.toHaveBeenCalled();
    expect(browser).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

test('a verified returned body is revoked on native lock while JS still reports active', async () => {
  const move = installReportAppState();
  const native = reportNativeWitness();
  jest.mocked(conversationExecutionNative).mockReturnValue(native.adapter);
  const { f, browser, read } = await openReport();
  try {
    await click();
    await waitFor(() => expect(browser).toHaveBeenCalledTimes(1));
    await move('background');
    await move('active');
    expect(await screen.findByText('Synthetic paragraph 1.')).toBeVisible();
    expect(read).toHaveBeenCalledTimes(2);
    expect(AppState.currentState).toBe('active');
    await act(() => native.set(false, true));
    expect(await screen.findByText(unavailable)).toBeVisible();
    expect(screen.queryByText('Synthetic paragraph 1.')).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    f.close();
  }
});

test.each([
  ['inactive only', 'none'],
  ['late background', 'late'],
  ['prompt background', 'prompt'],
] as const)(
  'a selected browser citation observes inactive then %s without ordinary resume',
  async (_case, departure) => {
    const move = installReportAppState();
    const native = reportNativeWitness();
    const clock = jest
      .spyOn(globalThis.performance, 'now')
      .mockReturnValue(100);
    jest.mocked(conversationExecutionNative).mockReturnValue(native.adapter);
    const { f, nav, browser, read } = await openReport();
    try {
      const route = nav.getSnapshot().currentRoute.key;
      await click();
      await waitFor(() => expect(browser).toHaveBeenCalledTimes(1));
      await move('inactive');
      expect(screen.queryByText('Synthetic paragraph 1.')).toBeNull();
      if (departure === 'late') clock.mockReturnValue(1_000_000);
      if (departure !== 'none') await move('background');
      expect(read).toHaveBeenCalledTimes(1);
      await move('active');
      if (departure === 'prompt') {
        expect(await screen.findByText('Synthetic paragraph 1.')).toBeVisible();
        expect(read).toHaveBeenCalledTimes(2);
        expect(read.mock.calls[1]?.[0]).toEqual(read.mock.calls[0]?.[0]);
      } else {
        expect(await screen.findByText(unavailable)).toBeVisible();
        expect(read).toHaveBeenCalledTimes(1);
      }
      expect(nav.getSnapshot().currentRoute.key).toBe(route);
      expect(browser).toHaveBeenCalledTimes(1);
    } finally {
      f.close();
    }
  },
);
