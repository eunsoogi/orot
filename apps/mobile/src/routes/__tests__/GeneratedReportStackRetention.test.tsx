import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { AppState, ScrollView } from 'react-native';
import { openGeneratedReportReader } from '../../generatedReports/readers';
import { generatedReportCopy as copy } from '../../generatedReports/text';
import type {
  GeneratedReportDetail,
  GeneratedReportRow,
} from '../../generatedReports/types';
import { createNavigationGeometrySnapshot } from '../../navigation/navigationGeometry';
import { openGeometry } from '../../navigation/__fixtures__/navigationOpenGeometry';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { renderRecordsRouteTest } from '../testSupport/renderRecordsRouteTest';

let mockGeometry: ReturnType<typeof createNavigationGeometrySnapshot>;
jest.mock('../../navigation/NavigationGeometryProvider', () => ({
  ...jest.requireActual('../../navigation/NavigationGeometryProvider'),
  useNavigationGeometry: () => mockGeometry,
}));
jest.mock('../../generatedReports/readers', () => ({
  openGeneratedReportReader: jest.fn(),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const row = (i: number): GeneratedReportRow => ({
  id: `entry-${i}`,
  key: `summary:entry-${i}`,
  origin: 'summary',
  kind: 'health_summary',
  createdAt: new Date(Date.UTC(2030, 0, 40 - i)).toISOString(),
  unavailable: false,
});
const id = (i: number) => `generated-report-${row(i).key}`;

function hold<T>() {
  let release!: (value: T) => void;
  return {
    pending: new Promise<T>(resolve => {
      release = resolve;
    }),
    release,
  };
}

beforeEach(() => {
  AppState.currentState = 'active';
  jest.clearAllMocks();
});

afterEach(() => jest.restoreAllMocks());

test.each([false, true])(
  'shared Back retains the second page and original scroll owner, open Duo=%s',
  async duo => {
    mockGeometry = createNavigationGeometrySnapshot({
      ...openGeometry,
      reservedRegions: duo ? openGeometry.reservedRegions : [],
    });
    const later = hold<GeneratedReportRow[]>();
    const first = Array.from({ length: 20 }, (_, i) => row(i));
    const second = Array.from({ length: 20 }, (_, i) => row(20 + i));
    const list = jest
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockReturnValueOnce(later.pending);
    const text = 'Synthetic selected report body';
    const read = jest.fn(async () => ({ paragraphs: [text] }));
    jest.mocked(openGeneratedReportReader).mockResolvedValue({
      list,
      read,
      readBookmarkedDiseasePossibilities: async () => null,
    });
    const controller = await renderRecordsRouteTest();
    await fireEvent.press(screen.getByTestId('records-open-generated-reports'));
    const owner = controller.getSnapshot().currentRoute.key;
    const host = within(screen.getByTestId(`navigation-route-scene-${owner}`));
    const scroll = host.getByTestId('navigation-route-scroll');
    await fireEvent.press(await host.findByRole('button', { name: copy.more }));
    const anchor = await host.findByTestId(id(37));
    await fireEvent.scroll(scroll, {
      nativeEvent: { contentOffset: { x: 0, y: 340 } },
    });
    await fireEvent.press(host.getByRole('button', { name: copy.more }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    await fireEvent.press(anchor);
    expect(controller.getSnapshot().currentRoute.name).toBe(
      'generated-report-detail',
    );
    expect(screen.queryByRole('button', { name: copy.back })).toBeNull();
    expect(screen.queryByTestId(id(37))).toBeNull();
    await waitFor(() => expect(screen.getByText(text)).toBeVisible());
    expect(read).toHaveBeenCalledWith(
      row(37),
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(text);
    const control = duo
      ? 'navigation-right-rail'
      : 'navigation-bottom-single-row';
    expect(
      within(screen.getByTestId(control)).getByTestId('navigation-back'),
    ).toBeEnabled();
    await act(() => later.release([row(60)]));
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
    const resumeFrames: FrameRequestCallback[] = [];
    jest
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation(callback => {
        resumeFrames.push(callback);
        return resumeFrames.length;
      });
    await fireEvent.press(screen.getByTestId('navigation-back'));
    await act(() => {
      for (const frame of [...resumeFrames]) frame(performance.now());
    });
    expect(scrollTo).toHaveBeenCalledWith({ x: 0, y: 340, animated: false });
    expect(controller.getSnapshot().currentRoute.key).toBe(owner);
    const restored = within(
      screen.getByTestId(`navigation-route-scene-${owner}`),
    );
    expect(restored.getByTestId('navigation-route-scroll')).toBe(scroll);
    expect(restored.getByTestId(id(37))).toBe(anchor);
    expect(restored.getByTestId(id(39))).toBeVisible();
    expect(restored.queryByTestId(id(60))).toBeNull();
    expect(list).toHaveBeenCalledTimes(3);
    await fireEvent.press(screen.getByTestId('navigation-back'));
    expect(controller.getSnapshot().currentRoute.name).toBe('root');
  },
);

test('source deletion while the child is reading cancels selected proof and clears the covered list', async () => {
  mockGeometry = null;
  const held = hold<GeneratedReportDetail>();
  const list = jest
    .fn()
    .mockResolvedValueOnce([row(0)])
    .mockResolvedValue([]);
  const read = jest.fn(
    (_row: GeneratedReportRow, _signal: AbortSignal) => held.pending,
  );
  jest.mocked(openGeneratedReportReader).mockResolvedValue({
    list,
    read,
    readBookmarkedDiseasePossibilities: async () => null,
  });
  const controller = await renderRecordsRouteTest();
  await fireEvent.press(screen.getByTestId('records-open-generated-reports'));
  await fireEvent.press(await screen.findByTestId(id(0)));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  expect(screen.getByText('이 자료를 불러오는 중이에요.')).toBeVisible();
  expect(screen.queryByTestId('generated-report-detail')).toBeNull();
  await act(() => notifyLocalSourceDeleted());
  expect(read.mock.calls[0]?.[1].aborted).toBe(true);
  await act(() => held.release({ paragraphs: ['Deleted synthetic body'] }));
  expect(screen.queryByText('Deleted synthetic body')).toBeNull();
  expect(screen.getByText(copy.unavailable)).toBeVisible();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(controller.getSnapshot().currentRoute.name).toBe('generated-reports');
  expect(await screen.findByText(copy.empty)).toBeVisible();
  expect(screen.queryByTestId(id(0))).toBeNull();
});

test('dedicated detail shows selected metadata while retry and unavailable stay bound to that row', async () => {
  mockGeometry = null;
  const selected = row(0);
  const list = jest.fn(async () => [selected]);
  const read = jest
    .fn(
      async (
        _row: GeneratedReportRow,
        _signal: AbortSignal,
      ): Promise<GeneratedReportDetail | null> => null,
    )
    .mockRejectedValueOnce(new Error('Synthetic protected read failure'))
    .mockResolvedValueOnce(null);
  jest.mocked(openGeneratedReportReader).mockResolvedValue({
    list,
    read,
    readBookmarkedDiseasePossibilities: async () => null,
  });
  const controller = await renderRecordsRouteTest();
  await fireEvent.press(screen.getByTestId('records-open-generated-reports'));
  await fireEvent.press(await screen.findByTestId(id(0)));
  expect(await screen.findByText('이 자료를 불러오지 못했어요.')).toBeVisible();
  const scene = within(
    screen.getByTestId(
      `navigation-route-scene-${controller.getSnapshot().currentRoute.key}`,
    ),
  );
  expect(
    scene.getByTestId('generated-material-detail-title'),
  ).toHaveTextContent(copy.health_summary);
  expect(scene.getByText('보관 위치: 저장된 분석')).toBeVisible();
  expect(scene.queryByText(selected.key)).toBeNull();
  expect(scene.queryByText(copy.title)).toBeNull();
  expect(scene.queryByRole('button', { name: copy.back })).toBeNull();
  expect(scene.queryByTestId('generated-report-detail')).toBeNull();
  await fireEvent.press(scene.getByRole('button', { name: copy.retry }));
  expect(await scene.findByText(copy.unavailable)).toBeVisible();
  expect(scene.queryByRole('button', { name: copy.retry })).toBeNull();
  expect(scene.queryByTestId('generated-report-detail')).toBeNull();
  expect(read.mock.calls.map(([item]) => item)).toEqual([selected, selected]);
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(controller.getSnapshot().currentRoute.name).toBe('generated-reports');
  expect(await screen.findByTestId(id(0))).toBeVisible();
  expect(list).toHaveBeenCalledTimes(1);
});
