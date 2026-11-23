import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { AppState, ScrollView } from 'react-native';
import type { AiFeatureLocalData } from '../../aiFeatures/integration/localData';
import {
  openGeneratedReportReader,
  createGeneratedReportReader,
} from '../../generatedReports/readers';
import { possibilityReportTemplate } from '../../ragConversation/conversationReportTemplate';
import { createLocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import { setup } from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { renderRecordsRouteTest } from '../testSupport/renderRecordsRouteTest';

jest.mock('../../generatedReports/readers', () => ({
  ...jest.requireActual('../../generatedReports/readers'),
  openGeneratedReportReader: jest.fn(),
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

async function fixture() {
  const f = await setup();
  const t = possibilityReportTemplate();
  await f.save('records-proof', {
    entryIntent: 'possibilities',
    answer: [
      `# ${t.title}`,
      ...t.sections.map(
        (section, i) => `## ${section}\nSynthetic paragraph ${i + 1}.`,
      ),
    ].join('\n'),
    sources: [f.personal],
    citations: [f.personal.reference],
  });
  const repository = createLocalHealthEvidenceRepository(f.db);
  const readRecord = jest.spyOn(repository, 'readRecord');
  const reader = createGeneratedReportReader(f.db, {
    data: async () =>
      ({
        repository,
        loadStaleArtifacts: async () => [],
      }) as unknown as AiFeatureLocalData,
    records: async () => f.repository,
  });
  const selected = jest.spyOn(reader.archivedSources!, 'resolve');
  const readSource = jest.spyOn(reader.archivedSources!, 'read');
  const readReport = jest.spyOn(reader, 'read');
  jest.mocked(openGeneratedReportReader).mockResolvedValue(reader);
  const nav = await renderRecordsRouteTest();
  await fireEvent.press(screen.getByTestId('records-open-generated-reports'));
  const list = nav.getSnapshot().currentRoute.key;
  await fireEvent.press(
    await screen.findByTestId('generated-report-conversation:records-proof'),
  );
  const report = nav.getSnapshot().currentRoute.key;
  const pill = await screen.findByTestId('generated-report-source-citation-0');
  return {
    f,
    nav,
    list,
    report,
    pill,
    readRecord,
    selected,
    readReport,
    readSource,
  };
}

test('tap reads the one approved original and shared Back returns to the verified report and retained list', async () => {
  const { f, nav, list, report, pill, readRecord, selected, readReport } =
    await fixture();
  const reportOwner = () =>
    within(screen.getByTestId(`navigation-route-scene-${report}`));
  try {
    expect(readReport).toHaveBeenCalledTimes(1);
    expect(selected).not.toHaveBeenCalled();
    expect(readRecord).not.toHaveBeenCalled();
    expect(screen.queryByTestId('ai-feature-source-detail')).toBeNull();
    await fireEvent.scroll(
      reportOwner().getByTestId('navigation-route-scroll'),
      {
        nativeEvent: { contentOffset: { x: 0, y: 190 } },
      },
    );
    await fireEvent.press(pill);
    expect(nav.getSnapshot().currentRoute.name).toBe('generated-report-source');
    expect(JSON.stringify(nav.getSnapshot())).not.toContain(f.inside.id);
    expect(screen.getAllByTestId('navigation-back')).toHaveLength(1);
    expect(screen.queryByTestId('ai-feature-source-back')).toBeNull();
    expect(
      await screen.findByTestId('ai-feature-source-content'),
    ).toBeVisible();
    expect(selected).toHaveBeenCalledWith(
      {
        sessionId: 'selected',
        sessionVersion: 0,
        turnId: 'records-proof',
        createdAt: expect.any(String),
      },
      0,
      expect.any(AbortSignal),
    );
    expect(readRecord).toHaveBeenCalledWith(
      'health_observation',
      f.inside.id,
      expect.any(AbortSignal),
    );
    expect(readRecord.mock.calls.every(([, id]) => id === f.inside.id)).toBe(
      true,
    );
    const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo');
    await fireEvent.press(screen.getByTestId('navigation-back'));
    expect(nav.getSnapshot().currentRoute.key).toBe(report);
    expect(
      await screen.findByTestId('generated-report-source-citation-0'),
    ).toBeVisible();
    expect(readReport).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(scroll).toHaveBeenCalledWith({ x: 0, y: 190, animated: false }),
    );
    await fireEvent.press(screen.getByTestId('navigation-back'));
    expect(nav.getSnapshot().currentRoute.key).toBe(list);
    expect(
      await screen.findByTestId('generated-report-conversation:records-proof'),
    ).toBeVisible();
  } finally {
    f.close();
  }
});

test('an original whose session was hidden and restored under a new version cannot reopen from its old pill', async () => {
  const { f, nav, pill, readRecord, selected } = await fixture();
  try {
    const hidden = await f.storage.hideSession('selected', 0);
    expect(await f.storage.undoHiddenSession('selected', hidden!)).toBe(2);
    await fireEvent.press(pill);
    expect(nav.getSnapshot().currentRoute.name).toBe('generated-report-source');
    expect(
      await screen.findByTestId('generated-report-source-unavailable'),
    ).toBeVisible();
    expect(selected).toHaveBeenCalledWith(
      expect.objectContaining({ sessionVersion: 0 }),
      0,
      expect.any(AbortSignal),
    );
    expect(readRecord).not.toHaveBeenCalled();
    expect(screen.queryByTestId('ai-feature-source-content')).toBeNull();
    await fireEvent.press(screen.getByTestId('navigation-back'));
    expect(await screen.findByText('현재 열 수 없는 자료예요.')).toBeVisible();
    expect(
      screen.queryByTestId('generated-report-source-citation-0'),
    ).toBeNull();
  } finally {
    f.close();
  }
});

function holdOriginal(
  readRecord: Awaited<ReturnType<typeof fixture>>['readRecord'],
) {
  const original = readRecord.getMockImplementation()!;
  let finish!: () => void;
  const suspended = new Promise<void>(resolve => {
    finish = resolve;
  });
  let captured = false;
  readRecord.mockImplementationOnce(async (...args) => {
    const record = await original(...args);
    captured = Boolean(record);
    await suspended;
    return record;
  });
  return { captured: () => captured, finish };
}

test('a deleted original cannot settle a held source read or resurrect the report on Back', async () => {
  const { f, nav, report, pill, readRecord, readSource } = await fixture();
  const held = holdOriginal(readRecord);
  try {
    await fireEvent.press(pill);
    await waitFor(() => expect(held.captured()).toBe(true));
    const sourceSignal = readSource.mock.calls[0]?.[2];
    expect(sourceSignal?.aborted).toBe(false);
    await f.db.execute('DELETE FROM health_observations WHERE id = ?', [
      f.inside.id,
    ]);
    await act(() => notifyLocalSourceDeleted());
    await waitFor(() => expect(sourceSignal?.aborted).toBe(true));
    await act(held.finish);
    expect(
      screen.getByTestId('generated-report-source-unavailable'),
    ).toBeVisible();
    expect(screen.queryByTestId('ai-feature-source-content')).toBeNull();
    await fireEvent.press(screen.getByTestId('navigation-back'));
    expect(nav.getSnapshot().currentRoute.key).toBe(report);
    expect(await screen.findByText('현재 열 수 없는 자료예요.')).toBeVisible();
    expect(
      screen.queryByTestId('generated-report-source-citation-0'),
    ).toBeNull();
  } finally {
    held.finish();
    f.close();
  }
});

test('an already completed native pop synchronously cancels the canonical read before React cleanup', async () => {
  const { f, nav, report, pill, readRecord, readSource } = await fixture();
  const held = holdOriginal(readRecord);
  try {
    await fireEvent.press(pill);
    await waitFor(() => expect(held.captured()).toBe(true));
    const child = nav.getSnapshot().currentRoute.key;
    const signal = readSource.mock.calls[0]?.[2];
    expect(signal?.aborted).toBe(false);
    await act(() => {
      expect(nav.reconcileNativeBack(child)).toBe(true);
      expect(signal?.aborted).toBe(true);
    });
    await act(held.finish);
    expect(nav.getSnapshot().currentRoute.key).toBe(report);
    expect(
      await screen.findByTestId('generated-report-source-citation-0'),
    ).toBeVisible();
    expect(screen.queryByTestId('ai-feature-source-content')).toBeNull();
  } finally {
    held.finish();
    f.close();
  }
});
