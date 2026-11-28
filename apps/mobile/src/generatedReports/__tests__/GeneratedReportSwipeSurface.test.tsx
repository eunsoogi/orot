import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, AppState, I18nManager, StyleSheet } from 'react-native';
import { GeneratedReportBrowser } from '../GeneratedReportBrowser';
import type { GeneratedReportRow } from '../types';

const row = (id: string): GeneratedReportRow => ({
  id,
  key: `conversation:${id}`,
  kind: 'possibilities',
  origin: 'conversation',
  unavailable: false,
  createdAt: '2035-01-01T00:00:00Z',
});
const first = row('first');
const second = row('second');

function touch(previousPageX: number, currentPageX: number, time: number) {
  return {
    nativeEvent: { touches: [{}] },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: time,
      touchBank: [
        {
          touchActive: true,
          startPageX: 150,
          startPageY: 50,
          previousPageX,
          currentPageX,
          previousPageY: 50,
          currentPageY: 50,
          previousTimeStamp: time - 1,
          currentTimeStamp: time,
        },
      ],
    },
  };
}

async function drag(item: GeneratedReportRow) {
  const viewport = screen.getByTestId(`generated-report-swipe-${item.key}`);
  const start = touch(150, 150, 1);
  const early = touch(150, 132, 2);
  const move = touch(132, 102, 3);
  const end = touch(102, 85, 4);
  await act(() => {
    viewport.props.onStartShouldSetResponderCapture(start);
    expect(viewport.props.onMoveShouldSetResponderCapture(early)).toBe(true);
    viewport.props.onResponderGrant(early);
    viewport.props.onResponderMove(move);
    viewport.props.onResponderMove(end);
  });
  return async (cancel = false) => {
    await act(() =>
      cancel
        ? viewport.props.onResponderTerminate(end)
        : viewport.props.onResponderRelease(end),
    );
  };
}

const visibleAction = () =>
  screen.queryAllByRole('button', { name: '이 목록에서 삭제' });
const clip = (item: GeneratedReportRow) =>
  StyleSheet.flatten(
    screen.getByTestId(`generated-report-swipe-${item.key}-action-clip`, {
      includeHiddenElements: true,
    }).props.style,
  );
const x = (item: GeneratedReportRow) =>
  StyleSheet.flatten(
    screen.getByTestId(`generated-report-swipe-${item.key}-content`).props
      .style,
  )?.transform?.[0]?.translateX;

afterEach(() => jest.restoreAllMocks());

test.each([false, true])(
  'the owned records list clips only the uncovered physical right edge (RTL: %s)',
  async rtl => {
    jest.replaceProperty(I18nManager, 'isRTL', rtl);
    const anchor = rtl ? { start: 0 } : { end: 0 };
    AppState.currentState = 'active';
    const prepare = jest.fn(async () => jest.fn(async () => true));
    const read = jest.fn(async () => null);
    const dialog = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const open = async () => ({
      list: async () => [first, second],
      read,
      prepareCatalogRemoval: prepare,
    });
    const ownership = { isCurrent: () => true, subscribe: () => () => {} };
    const openDetail = jest.fn();
    await render(
      <GeneratedReportBrowser
        destination
        ownership={ownership}
        open={open}
        onOpenDestination={openDetail}
      />,
    );
    const viewport = await screen.findByTestId(
      `generated-report-swipe-${first.key}`,
    );
    expect(StyleSheet.flatten(viewport.props.style)).toMatchObject({
      overflow: 'hidden',
    });
    expect(clip(first)).toMatchObject({
      overflow: 'hidden',
      width: 0,
      ...anchor,
    });
    expect(clip(second)?.width).toBe(0);
    expect(
      StyleSheet.flatten(
        screen.getByTestId(`generated-report-swipe-${first.key}-action-lane`, {
          includeHiddenElements: true,
        }).props.style,
      ),
    ).toMatchObject({ width: 64, position: 'absolute', ...anchor });
    expect(x(first)).toBe(0);
    expect(x(second)).toBe(0);
    expect(visibleAction()).toHaveLength(0);

    const cancelFirst = await drag(first);
    expect(clip(first)?.width).toBe(47);
    expect(x(first)).toBe(-47);
    await cancelFirst(true);
    expect(clip(first)?.width).toBe(0);
    expect(x(first)).toBe(0);

    const releaseFirst = await drag(first);
    expect(x(first)).toBe(-47);
    expect(x(second)).toBe(0);
    expect(visibleAction()).toHaveLength(0);
    expect(dialog).not.toHaveBeenCalled();
    await releaseFirst();
    expect(x(first)).toBe(-64);
    expect(clip(first)?.width).toBe(64);
    expect(visibleAction()).toHaveLength(1);

    const releaseSecond = await drag(second);
    expect(x(second)).toBe(-47);
    await releaseSecond();
    expect(x(first)).toBe(0);
    expect(x(second)).toBe(-64);
    expect(clip(first)?.width).toBe(0);
    expect(clip(second)?.width).toBe(64);
    expect(visibleAction()).toHaveLength(1);
    expect(prepare).not.toHaveBeenCalled();
    await fireEvent.press(visibleAction()[0]!);
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(dialog.mock.calls[0]?.[1]).toContain('원래 대화와 답변은 남아요');
    expect(read).not.toHaveBeenCalled();
  },
);
