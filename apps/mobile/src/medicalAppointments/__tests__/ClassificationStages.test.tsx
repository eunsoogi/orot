import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, StyleSheet } from 'react-native';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { MedicalAppointmentReviewView } from '../MedicalAppointmentReviewView';
import { ClassificationProgress } from '../ClassificationProgress';
import * as workflow from '../classificationWorkflow';
import {
  event,
  renderScreen,
  repository,
  result,
  selectedProvider,
} from '../MedicalAppointmentClassificationScreenTestFixtures';

afterEach(() => jest.restoreAllMocks());

test('shows only the current stage, with exact completed-event progress and no duplicate request', async () => {
  const events = [
    event('a', '첫 진료', '2035-06-02'),
    event('b', '둘째 진료', '2035-06-03'),
  ];
  let finish!: (value: workflow.ClassificationRunResult) => void;
  let progress!: NonNullable<
    workflow.ClassifyCalendarEventsInput['onProgress']
  >;
  const classify = jest
    .spyOn(workflow, 'classifyCalendarEvents')
    .mockImplementation(input => {
      progress = input.onProgress!;
      return new Promise(resolve => {
        finish = resolve;
      });
    });
  const { view } = await renderScreen([events], repository());
  expect(screen.getByTestId('medical-appointment-confirmation')).toBeTruthy();
  expect(screen.queryByTestId('medical-appointment-manual')).toBeNull();
  expect(JSON.stringify(view.toJSON())).not.toContain('RCTScrollView');
  const button = screen.getByTestId('medical-appointment-import');
  // Busy state removes the repeat action; the existing synchronous owner also guards early duplicate events.
  await fireEvent.press(button);
  expect(screen.queryByTestId('medical-appointment-import')).toBeNull();
  expect(classify).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(0);
  expect(screen.queryByTestId('medical-appointment-confirmation')).toBeNull();
  await act(async () =>
    progress({
      ...result(events.slice(0, 1)),
      status: 'partial',
      totalBatches: 2,
    }),
  );
  expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(50);
  expect(screen.queryByText('첫 진료')).toBeNull();
  expect(screen.queryByTestId('medical-appointment-results')).toBeNull();
  await act(async () => finish(result(events)));
  expect(screen.getByTestId('medical-appointment-results')).toBeTruthy();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByText('첫 진료')).toBeTruthy();
  const resultTree = JSON.stringify(view.toJSON());
  expect(resultTree).not.toContain('chevron.left');
  expect(resultTree).not.toContain('chevron.right');
  expect(screen.getByText('다음 페이지')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('medical-appointment-next-result'));
  expect(screen.getByText('둘째 진료')).toBeTruthy();
  await fireEvent.press(
    screen.getByTestId('medical-appointment-previous-result'),
  );
  expect(screen.getByText('첫 진료')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('medical-appointment-import'));
  expect(screen.getByTestId('medical-appointment-confirmation')).toBeTruthy();
  expect(classify).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(view.toJSON())).not.toContain('RCTScrollView');
});

const base = {
  provider: selectedProvider(),
  providerUnavailable: false,
  providerReady: true,
  loading: false,
  calendarLoading: false,
  calendarUnavailable: false,
  classifying: false,
  completed: false,
  accessAvailable: true,
  queryComplete: true,
  message: '',
  eventCount: 1,
  candidates: [],
  savingId: null,
  savedIds: new Set<string>(),
  onImport: async () => undefined,
};

test.each([false, true])(
  'uses fade-out and fade-in between all stages; Reduce Motion=%s',
  async reduced => {
    const fixture = (classifying: boolean, completed: boolean) => (
      <NavigationMotionContext.Provider value={reduced}>
        <MedicalAppointmentReviewView
          {...base}
          classifying={classifying}
          completed={completed}
        />
      </NavigationMotionContext.Provider>
    );
    const view = await render(fixture(false, false));
    jest.mocked(Animated.timing).mockClear();
    await view.rerender(fixture(true, false));
    expect(screen.getByTestId('medical-appointment-progress')).toBeTruthy();
    await view.rerender(fixture(false, true));
    expect(screen.getByTestId('medical-appointment-results')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('medical-appointment-import'));
    expect(screen.getByTestId('medical-appointment-confirmation')).toBeTruthy();
    const values = jest
      .mocked(Animated.timing)
      .mock.calls.map(call => call[1].toValue);
    expect(values).toEqual(reduced ? [] : [1, 0, 1, 0, 1, 0]);
  },
);

test('does not invent progress for an empty or unfinished input and distinguishes saving', async () => {
  const view = await render(
    <ClassificationProgress classified={0} total={0} saving={false} />,
  );
  expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(0);
  await view.rerender(
    <ClassificationProgress classified={2} total={3} saving={false} />,
  );
  expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(66);
  await view.rerender(
    <ClassificationProgress classified={3} total={3} saving />,
  );
  expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(
    100,
  );
  expect(screen.getByText('분류한 일정을 저장하고 있어요.')).toBeTruthy();
});

test.each([
  { width: 292, height: 440 },
  { width: 608, height: 316 },
])(
  'shares the measured circle anchor across all stages of the $width-point pane',
  async layout => {
    const control = (classifying: boolean, completed: boolean) => (
      <NavigationMotionContext.Provider value>
        <MedicalAppointmentReviewView
          {...base}
          classifying={classifying}
          completed={completed}
        />
      </NavigationMotionContext.Provider>
    );
    const view = await render(control(false, false));
    const slot = async (stage: string) => {
      await fireEvent(screen.getByTestId(stage), 'layout', {
        nativeEvent: { layout },
      });
      return StyleSheet.flatten(
        screen.getByTestId('classification-circle-slot').props.style,
      );
    };
    const before = await slot('medical-appointment-confirmation');
    const captions = StyleSheet.flatten(
      screen.getByTestId('classification-stage-captions').props.style,
    );
    expect(before.top + before.height / 2).toBe(layout.height / 2);
    expect(captions.top).toBeGreaterThan(before.top + before.height);
    expect(screen.getByText('시작')).toBeTruthy();
    expect(
      screen.getByTestId('medical-appointment-select-provider'),
    ).toBeTruthy();
    await view.rerender(control(true, false));
    expect(await slot('medical-appointment-progress')).toEqual(before);
    expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(
      0,
    );
    await view.rerender(control(false, true));
    expect(await slot('medical-appointment-results')).toEqual(before);
    expect(screen.getByText('다시')).toBeTruthy();
    expect(JSON.stringify(view.toJSON())).not.toContain('RCTScrollView');
  },
);
