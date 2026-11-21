import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { ClassificationProgress } from '../ClassificationProgress';
import { ClassificationPagedStage } from '../ClassificationPagedStage';
import { ClassificationResultsStage } from '../ClassificationResultsStage';

const originalDimensions = {
  window: Dimensions.get('window'),
  screen: Dimensions.get('screen'),
};

afterEach(async () => {
  jest.restoreAllMocks();
  await act(async () => Dimensions.set(originalDimensions));
});

const layout = async (id: string, width: number, height: number) =>
  fireEvent(screen.getByTestId(id, { includeHiddenElements: true }), 'layout', {
    nativeEvent: { layout: { width, height } },
  });

test('uses a strong title and restrained but readable disclosure when the measured stack fits', async () => {
  const copy = {
    title: '합성 분류 제목',
    supporting: '어떤 일정을 분류하는지 알려요.',
    privacy: '선택한 외부 수신자에게 동의한 제목과 시간만 전송해요.',
    warning: '',
  };
  await render(
    <ClassificationPagedStage
      testID="caption-pane"
      caption={copy}
      documents={[Object.values(copy).filter(Boolean).join('\n\n')]}
      actionTitle="시작"
      actionLabel="분류 시작"
      onAction={jest.fn()}
    />,
  );
  await layout('caption-pane', 390, 650);
  await layout('classification-caption-measurement', 390, 110);
  expect(
    screen.getByTestId('classification-confirmation-caption'),
  ).toBeTruthy();
  const title = screen.getByRole('header', { name: copy.title });
  expect(StyleSheet.flatten(title.props.style).fontWeight).toBe('700');
  const footnote = screen.getByText(copy.privacy);
  expect(StyleSheet.flatten(footnote.props.style).fontSize).toBeLessThan(
    StyleSheet.flatten(title.props.style).fontSize,
  );
  await layout('caption-pane', 280, 150);
  expect(
    screen.queryByTestId('classification-confirmation-caption'),
  ).toBeNull();
  expect(screen.getByTestId('classification-page-text')).toHaveTextContent(
    /제목과 시간만 전송해요/,
  );
});

const rows = Array.from({ length: 8 }, (_, index) => ({
  id: String(index),
  title: `합성 일정 ${index + 1}`,
  when: '6월 2일 09:05–09:45',
  category: '의료 방문·검사 일정',
  details: `합성 일정 ${index + 1}\n\n전체 시간 및 분류 근거 ${index + 1}`,
}));

test.each([
  { width: 430, height: 660, scale: 1 },
  { width: 300, height: 550, scale: 1.6 },
])(
  'pages complete compact rows, keeping long detail accessible at $width points and $scale scale',
  async ({ width, height, scale }) => {
    await act(async () =>
      Dimensions.set({
        window: { width, height, scale: 2, fontScale: scale },
        screen: { width, height, scale: 2, fontScale: scale },
      }),
    );
    const view = await render(
      <ClassificationResultsStage
        rows={rows}
        summary="전체 분류 범위"
        notice=""
        restart={jest.fn()}
      />,
    );
    await layout('medical-appointment-results', width, height);
    const first = screen.getAllByTestId('classification-result-row');
    expect(first.length).toBeGreaterThanOrEqual(scale === 1 ? 2 : 1);
    expect(first.length).toBeLessThan(rows.length);
    expect(screen.getAllByText(/09:05/)[0].props.numberOfLines).toBe(1);
    expect(screen.getByText(rows[0]!.title).props.numberOfLines).toBe(1);
    await fireEvent.press(first[0]!);
    expect(screen.getByTestId('classification-result-reader')).toBeTruthy();
    expect(screen.getByText(/전체 시간 및 분류 근거 1/)).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: '분류된 일정 목록으로 돌아가기' }),
    );
    await fireEvent.press(
      screen.getByTestId('medical-appointment-next-result'),
    );
    expect(screen.queryByText(rows[0]!.title)).toBeNull();
    expect(screen.getByText(rows[first.length]!.title)).toBeTruthy();
    await fireEvent.press(
      screen.getByTestId('medical-appointment-previous-result'),
    );
    expect(screen.getByText(rows[0]!.title)).toBeTruthy();
    expect(JSON.stringify(view.toJSON())).not.toMatch(
      /RCTScrollView|chevron\.(left|right)/,
    );
    await layout('medical-appointment-results', 240, 125);
    expect(screen.queryByTestId('classification-result-row')).toBeNull();
    expect(screen.getByTestId('classification-result-reader')).toBeTruthy();
    await layout('medical-appointment-results', width, height);
    expect(screen.getAllByTestId('classification-result-row')).toHaveLength(
      first.length,
    );
  },
);

test('ring and numeral move together under rapid updates; reset and Reduce Motion cancel older frames', async () => {
  let sequence = 0;
  const frames = new Map<number, (time: number) => void>();
  jest
    .spyOn(globalThis, 'requestAnimationFrame')
    .mockImplementation(callback => {
      frames.set(++sequence, callback);
      return sequence;
    });
  const cancel = jest
    .spyOn(globalThis, 'cancelAnimationFrame')
    .mockImplementation(id => {
      if (id != null) frames.delete(id);
    });
  const draw = (classified: number, reduce = false) => (
    <NavigationMotionContext.Provider value={reduce}>
      <ClassificationProgress
        total={100}
        classified={classified}
        saving={false}
      />
    </NavigationMotionContext.Provider>
  );
  const next = async (time: number) =>
    act(async () => {
      const ready = [...frames.values()];
      frames.clear();
      for (const callback of ready) callback(time);
    });
  const assertSame = () => {
    const number = Number(
      screen.getByTestId('classification-progress-number').props.children[0],
    );
    const arc = screen.getByTestId('classification-progress-arc').props
      .strokeDashoffset;
    expect(arc ?? 0).toBeCloseTo(2 * Math.PI * 44 * (1 - number / 100));
    return number;
  };
  const view = await render(draw(0));
  await view.rerender(draw(45));
  await next(100);
  await next(170);
  const intermediate = assertSame();
  expect(intermediate).toBeGreaterThan(0);
  expect(intermediate).toBeLessThan(45);
  const stale = [...frames.values()][0]!;
  await view.rerender(draw(80));
  await act(async () => stale(400));
  expect(assertSame()).toBe(intermediate);
  await next(200);
  await next(460);
  expect(assertSame()).toBe(80);
  expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(80);
  await view.rerender(draw(100));
  await next(470);
  expect(assertSame()).toBeLessThan(90);
  await view.rerender(draw(90));
  expect(assertSame()).toBe(90);
  await view.rerender(draw(100));
  await view.rerender(draw(100, true));
  expect(assertSame()).toBe(100);
  expect(frames.size).toBe(0);
  await view.rerender(draw(0));
  expect(assertSame()).toBe(0);
  expect(cancel).toHaveBeenCalled();
});
