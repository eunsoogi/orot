import { act, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { window } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { generatedReportCopy } from '../../generatedReports/text';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { setup } from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { openSavedGeneratedReportReferences } from '../openSavedGeneratedReportReferences';
import { SavedMemoryDetail } from '../SavedMemoryDetail';

jest.mock('../openSavedGeneratedReportReferences');
jest.mock('../../ragConversation/conversationExecutionNative');

const artifactId = 'saved-health-summary';
const current = () => true;

async function bookmarked() {
  const f = await setup();
  await f.summaryStorage.append(f.saved);
  await f.save(artifactId, {
    providerId: f.saved.providerId,
    modelId: f.saved.modelId,
    healthSummary: { summaryId: f.saved.id, window },
  });
  const pin = () =>
    f.storage.bookmarkHealthSummary({
      artifactId,
      lease: { id: 'selected', version: 0 },
      current,
    });
  expect(await pin()).toBe(true);
  const revise = () =>
    f.db.execute(
      "UPDATE health_observations SET payload_json=json_set(payload_json,'$.value.amount',83) WHERE id=?",
      [f.inside.id],
    );
  const read = (confirm = jest.fn().mockResolvedValue(true)) =>
    f.storage.readBookmarkedHistoricalHealthSummary(
      artifactId,
      current,
      confirm,
    );
  return { ...f, pin, revise, read };
}

test('the mounted Memory detail reads the exact original after model replacement and attested correction, then retires it on native lock', async () => {
  const f = await bookmarked();
  const previous = AppState.currentState;
  AppState.currentState = 'active';
  type Native = NonNullable<ReturnType<typeof conversationExecutionNative>>;
  type Event = Parameters<Parameters<Native['subscribe']>[0]>[0];
  let listener: ((event: Event) => void) | undefined;
  const verify = jest.fn().mockResolvedValue(true);
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    protectedDataAvailable: verify,
    subscribe(next: (event: Event) => void) {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  } as unknown as Native);
  try {
    const signal = new AbortController().signal;
    await f.storage.continuousSession(
      { providerId: 'synthetic', modelId: 'original' },
      'initial-pointer',
      '2026-11-01T00:00:00.000Z',
      signal,
    );
    await f.storage.continuousSession(
      { providerId: 'synthetic', modelId: 'different-model' },
      'replacement-session',
      '2026-11-02T00:00:00.000Z',
      signal,
    );
    await f.revise();
    expect(
      await f.storage.readSavedHealthSummaryReference(artifactId, current),
    ).toBeNull();
    expect(await f.pin()).toBe(false);
    jest.mocked(openSavedGeneratedReportReferences).mockResolvedValue(f.storage);
    const load = async () =>
      (await f.storage.listSavedGeneratedReportReferences()).map(row => ({
        sourceKind: 'saved_generated_report' as const,
        id: 'generated-report:' + row.artifactId,
        artifactId: row.artifactId,
        reportKind: row.reportKind,
        text: 'Synthetic report',
        createdAt: Date.parse(row.savedAt),
      }));
    const memoryId = 'generated-report:' + artifactId;
    const view = await render(<SavedMemoryDetail memoryId={memoryId} load={load} />);
    try {
      const original = f.saved.analysis.hypotheses[0]!.summary;
      expect(await screen.findByText(original)).toBeVisible();
      expect(
        screen.getByText(generatedReportCopy.historicalHealthSummary),
      ).toBeVisible();
      expect(screen.queryByRole('link')).toBeNull();
      expect(verify).toHaveBeenCalledTimes(2);
      await act(() =>
        listener?.({ kind: 'protectedData', available: false } as Event),
      );
      expect(screen.queryByText(original)).toBeNull();
    } finally {
      await view.unmount();
    }
  } finally {
    AppState.currentState = previous;
    f.close();
  }
});

test.each([
  'unattested',
  'denied',
  'deleted-source',
  'deleted-session',
  'rewritten',
  'changed-pin',
] as const)('historical Memory requires positive proof: %s', async scenario => {
  const f = await bookmarked();
  try {
    if (scenario === 'unattested') {
      await f.db.execute('DELETE FROM standalone_summary_body_receipts');
    }
    await f.revise();
    if (scenario === 'deleted-source')
      await f.repository.delete('health_observation', f.inside.id);
    if (scenario === 'deleted-session')
      await f.storage.deleteSession('selected');
    if (scenario === 'rewritten')
      await f.db.execute(
        "UPDATE symptom_summary_runs SET result_json=json_set(result_json,'$.analysis.hypotheses[0].summary','replacement') WHERE id=?",
        [f.saved.id],
      );
    if (scenario === 'changed-pin')
      await f.db.execute('UPDATE saved_health_summary_refs SET revision=?', [
        'synthetic-other-revision',
      ]);
    const confirm = jest.fn().mockResolvedValue(scenario !== 'denied');
    expect(await f.read(confirm)).toBeNull();
    expect(confirm).toHaveBeenCalledTimes(scenario === 'denied' ? 1 : 0);
  } finally {
    f.close();
  }
});

test('source or view loss during the native protection check cannot publish the old body', async () => {
  const f = await bookmarked();
  try {
    await f.revise();
    const result = await f.read(async () => {
      await f.repository.delete('health_observation', f.inside.id);
      return true;
    });
    expect(result).toBeNull();
  } finally {
    f.close();
  }
});
