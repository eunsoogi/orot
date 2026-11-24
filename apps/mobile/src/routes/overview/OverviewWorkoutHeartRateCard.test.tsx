import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { OverviewWorkoutHeartRateCard } from './OverviewWorkoutHeartRateCard';
import {
  setup,
  one,
  two,
  values,
} from './testSupport/overviewWorkoutCardHarness';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

const picker = () => screen.getByTestId('overview-workout-heart-rate-choose');
const option = (i: number) =>
  screen.findByTestId('overview-workout-heart-rate-option-' + i);
const result = () => screen.queryByTestId('overview-workout-heart-rate-result');

test('loads only an explicit bounded workout page and reads only the selected associated UUID', async () => {
  const lane = await setup();
  try {
    const view = await render(
      <OverviewWorkoutHeartRateCard active width={302} />,
    );
    expect(openLocalAgentMemoryDatabase).not.toHaveBeenCalled();
    expect(lane.queryWorkoutHeartRate).not.toHaveBeenCalled();
    await fireEvent.press(picker());
    const selected = await option(1);
    const pages = lane.statements.mock.calls.filter(
      ([sql]) =>
        sql.includes('FROM health_observations') && sql.includes('LIMIT'),
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]?.[1]).toEqual(expect.arrayContaining([21]));
    expect(
      screen.queryByTestId('overview-workout-heart-rate-option-2'),
    ).toBeNull();
    expect(lane.queryWorkoutHeartRate).not.toHaveBeenCalled();
    await fireEvent.press(selected);
    await waitFor(() =>
      expect(result()).toHaveTextContent(
        '운동 시간 안의 연결 심박수: 평균 90 bpm, 범위 60–130 bpm',
      ),
    );
    expect(lane.queryWorkoutHeartRate).toHaveBeenCalledTimes(1);
    expect(lane.queryWorkoutHeartRate).toHaveBeenCalledWith(two);
    expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
    expect(lane.querySamples).not.toHaveBeenCalled();
    await act(() => lane.revoke());
    expect(result()).toBeNull();
    await view.unmount();
  } finally {
    lane.close();
  }
});

test.each(['deleted', 'locked', 'blurred', 'changed'])(
  'does not publish a held native result after %s',
  async reason => {
    const lane = await setup();
    try {
      let release!: (value: typeof values) => void;
      lane.queryWorkoutHeartRate.mockReturnValueOnce(
        new Promise(resolve => {
          release = resolve;
        }),
      );
      const view = await render(
        <OverviewWorkoutHeartRateCard active width={undefined} />,
      );
      await fireEvent.press(picker());
      const selected = await option(0);
      const tapped = fireEvent.press(selected);
      await waitFor(() =>
        expect(lane.queryWorkoutHeartRate).toHaveBeenCalledWith(one),
      );
      if (reason === 'deleted') {
        await lane.repository.delete('health_observation', lane.first.id);
        await act(() =>
          notifyLocalSourceDeleted('healthkit', new Set([lane.first.id])),
        );
      } else if (reason === 'locked') await act(() => lane.revoke());
      else if (reason === 'blurred') {
        await view.rerender(
          <OverviewWorkoutHeartRateCard active={false} width={undefined} />,
        );
      } else
        await lane.repository.put('health_observation', {
          ...lane.first,
          endedAt: new Date(
            Date.parse(lane.first.endedAt!) + 30000,
          ).toISOString(),
        });
      await act(async () => {
        release(values);
        await tapped;
      });
      await waitFor(() => expect(result()).toBeNull());
      await view.unmount();
    } finally {
      lane.close();
    }
  },
);

test('a captured choice deleted before native admission never calls native', async () => {
  const lane = await setup();
  try {
    const view = await render(
      <OverviewWorkoutHeartRateCard active width={undefined} />,
    );
    await fireEvent.press(picker());
    const selected = await option(0);
    await lane.repository.delete('health_observation', lane.first.id);
    await fireEvent.press(selected);
    await waitFor(() => expect(result()).toBeNull());
    expect(lane.queryWorkoutHeartRate).not.toHaveBeenCalled();
    await view.unmount();
  } finally {
    lane.close();
  }
});

test.each(['reimport', 'repository replacement'])(
  'rejects a %s during the last delayed protected-data confirmation',
  async change => {
    const lane = await setup();
    try {
      let releaseNative!: (value: typeof values) => void;
      lane.queryWorkoutHeartRate.mockReturnValueOnce(
        new Promise(resolve => {
          releaseNative = resolve;
        }),
      );
      const view = await render(
        <OverviewWorkoutHeartRateCard active width={undefined} />,
      );
      await fireEvent.press(picker());
      const tapped = fireEvent.press(await option(0));
      await waitFor(() =>
        expect(lane.queryWorkoutHeartRate).toHaveBeenCalledWith(one),
      );
      const gate = lane.holdSecondProbe();
      releaseNative(values);
      await gate.entered;
      if (change === 'reimport') {
        await lane.repository.put('health_observation', {
          ...lane.first,
          endedAt: new Date(
            Date.parse(lane.first.endedAt!) + 30000,
          ).toISOString(),
        });
      } else lane.replaceOwner();
      await act(async () => {
        gate.release(true);
        await tapped;
      });
      expect(result()).toBeNull();
      expect(lane.queryWorkoutHeartRate).toHaveBeenCalledTimes(1);
      await view.unmount();
    } finally {
      lane.close();
    }
  },
);

test('a reimport during delayed pre-native confirmation sends no UUID to native', async () => {
  const lane = await setup();
  try {
    const view = await render(
      <OverviewWorkoutHeartRateCard active width={undefined} />,
    );
    await fireEvent.press(picker());
    const gate = lane.holdSecondProbe();
    const tapped = fireEvent.press(await option(0));
    await gate.entered;
    await lane.repository.put('health_observation', {
      ...lane.first,
      endedAt: new Date(Date.parse(lane.first.endedAt!) + 30000).toISOString(),
    });
    await act(async () => {
      gate.release(true);
      await tapped;
    });
    expect(result()).toBeNull();
    expect(lane.queryWorkoutHeartRate).not.toHaveBeenCalled();
    await view.unmount();
  } finally {
    lane.close();
  }
});
