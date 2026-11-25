import { act, render } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { GeneratedReportDetailDestination } from '../GeneratedReportDetailDestination';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { GeneratedReportContent } from '../GeneratedReportContent';
import { quarantinedHistoryFixture } from '../../aiFeatures/integration/testSupport/quarantinedHistoryFixture';
import {
  createGeneratedReportReader,
  openGeneratedReportReader,
} from '../readers';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { generatedReportCopy as copy } from '../text';
import { listRecentMaterial } from '../catalog';

jest.mock('../readers', () => ({
  ...jest.requireActual('../readers'),
  openGeneratedReportReader: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

const original = '심박수 128 count/min 기록이 있어요.';

async function fixture() {
  const f = await quarantinedHistoryFixture();
  const unexpectedSourceRead = jest.fn(async () => {
    throw new Error('Historical display cannot open source readers.');
  });
  const reader = createGeneratedReportReader(f.database, {
    data: unexpectedSourceRead,
    records: async () => f.repository,
  });
  const row = (await reader.list()).find(item => item.id === f.saved.id)!;
  const revise = (amount: number) =>
    f.database.execute(
      "UPDATE health_observations SET payload_json=json_set(payload_json,'$.value.amount', ?) WHERE id=?",
      [amount, f.inside.id],
    );
  const body = async () =>
    (
      await f.database.execute(
        'SELECT result_json FROM symptom_summary_runs WHERE id=?',
        [row.id],
      )
    ).rows[0]?.result_json;
  const read = (signal = new AbortController().signal, onLost = jest.fn()) =>
    reader.read(row, signal, onLost);
  return { ...f, row, revise, read, body, reader, unexpectedSourceRead };
}

type Native = NonNullable<ReturnType<typeof conversationExecutionNative>>;
type Event = Parameters<Parameters<Native['subscribe']>[0]>[0];
function nativeProtection() {
  let listener: ((event: Event) => void) | undefined;
  const verify = jest.fn<Promise<boolean>, []>().mockResolvedValue(true);
  const subscribed = jest.fn((next: (event: Event) => void) => {
    listener = next;
    return () => {
      listener = undefined;
    };
  });
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    protectedDataAvailable: verify,
    subscribe: subscribed,
  } as unknown as Native);
  return {
    verify,
    subscribed,
    lock: () =>
      listener?.({ kind: 'protectedData', available: false } as Event),
  };
}
beforeEach(() => {
  nativeProtection();
});

test('a real same-record amount correction keeps only the original saved content', async () => {
  const f = await fixture();
  try {
    const bytes = await f.body();
    await f.revise(83);
    expect(await f.body()).toBe(bytes);
    const row = (await listRecentMaterial(f.database)).find(
      item => item.origin === 'summary' && item.key === f.row.key,
    );
    expect(row).toEqual({ ...f.row, unavailable: false });
    if (!row || row.origin !== 'summary') throw new Error('Missing summary.');
    const detail = await f.reader.read(
      row,
      new AbortController().signal,
      jest.fn(),
    );
    expect(detail?.paragraphs).toContain(original);
    expect(detail?.warning).toBe(copy.historicalHealthSummary);
    expect(detail?.conversationSources).toBeUndefined();
    expect(f.unexpectedSourceRead).not.toHaveBeenCalled();
    const ui = await render(
      <NavigationMotionContext.Provider value>
        <GeneratedReportContent detail={detail!} />
      </NavigationMotionContext.Provider>,
    );
    expect(ui.getByText(original)).toBeVisible();
    expect(ui.queryByRole('link')).toBeNull();
    await ui.unmount();
    await f.quarantine();
    expect(
      (await listRecentMaterial(f.database)).some(
        item => item.key === f.row.key,
      ),
    ).toBe(false);
    expect(await f.read()).toBeNull();
  } finally {
    f.close();
  }
});

test.each([
  'rewrite-and-restore',
  'replace',
  'delete',
  'source-delete',
  'unclassified-first',
  'clean-replace',
  'later-unknown-origin',
  'source-reinsert',
  'unattested-legacy',
] as const)('body trust never survives %s', async mode => {
  const f = await fixture();
  try {
    const bytes = await f.body();
    if (mode === 'unclassified-first') {
      await f.database.execute(
        'INSERT INTO conversation_invalid_summaries VALUES (?)',
        [f.row.id],
      );
      await f.revise(83);
    } else if (mode === 'clean-replace') {
      await f.database.execute(
        'INSERT OR REPLACE INTO symptom_summary_runs SELECT * FROM symptom_summary_runs WHERE id=?',
        [f.row.id],
      );
    } else if (mode === 'unattested-legacy') {
      await f.database.execute(
        'DELETE FROM standalone_summary_body_receipts WHERE summary_id=?',
        [f.row.id],
      );
      await f.revise(86);
    } else {
      await f.revise(86);
      expect(await f.read()).not.toBeNull();
      if (mode === 'rewrite-and-restore') {
        await f.database.execute(
          "UPDATE symptom_summary_runs SET result_json=json_set(result_json,'$.analysis.hypotheses[0].summary','changed') WHERE id=?",
          [f.row.id],
        );
        await f.database.execute(
          'UPDATE symptom_summary_runs SET result_json=? WHERE id=?',
          [bytes!, f.row.id],
        );
      }
      if (mode === 'replace')
        await f.database.execute(
          'INSERT OR REPLACE INTO symptom_summary_runs SELECT * FROM symptom_summary_runs WHERE id=?',
          [f.row.id],
        );
      if (mode === 'delete')
        await f.database.execute(
          'DELETE FROM symptom_summary_runs WHERE id=?',
          [f.row.id],
        );
      if (mode === 'source-delete')
        await f.repository.delete('health_observation', f.inside.id);
      if (mode === 'later-unknown-origin')
        await f.database.execute(
          "UPDATE health_observations SET payload_json=json_set(payload_json,'$.provenance.source.sourceIdentifier','updated-source') WHERE id=?",
          [f.inside.id],
        );
      if (mode === 'source-reinsert')
        await f.database.execute(
          'INSERT OR REPLACE INTO health_observations SELECT * FROM health_observations WHERE id=?',
          [f.inside.id],
        );
    }
    expect(
      (await listRecentMaterial(f.database)).some(
        item => item.key === f.row.key,
      ),
    ).toBe(false);
    expect(await f.read()).toBeNull();
    expect(f.unexpectedSourceRead).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

test('while native protection is held, locking retires the selected historical read permanently', async () => {
  const f = await fixture();
  const native = nativeProtection();
  try {
    await f.revise(84);
    let release!: (allowed: boolean) => void;
    let entered!: () => void;
    const pending = new Promise<void>(resolve => {
      entered = resolve;
    });
    native.verify.mockImplementationOnce(
      () =>
        new Promise<boolean>(resolve => {
          release = resolve;
          entered();
        }),
    );
    const controller = new AbortController();
    const lost = jest.fn(() => controller.abort());
    const reading = f.read(controller.signal, lost);
    await pending;
    await act(() => native.lock());
    expect(lost).toHaveBeenCalledTimes(1);
    release(true);
    expect(await reading).toBeNull();
    expect(native.verify).toHaveBeenCalledTimes(1);
    expect(f.unexpectedSourceRead).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

test('the mounted Records destination erases a historical result when its native view lease is revoked', async () => {
  const f = await fixture();
  const native = nativeProtection();
  const previous = AppState.currentState;
  AppState.currentState = 'active';
  try {
    await f.revise(85);
    jest.mocked(openGeneratedReportReader).mockResolvedValue(f.reader);
    const ui = await render(
      <NavigationMotionContext.Provider value>
        <GeneratedReportDetailDestination active row={f.row} />
      </NavigationMotionContext.Provider>,
    );
    try {
      expect(await ui.findByText(original)).toBeVisible();
      await act(() => native.lock());
      expect(ui.queryByText(original)).toBeNull();
      expect(ui.getByText(copy.unavailable)).toBeVisible();
      expect(f.unexpectedSourceRead).not.toHaveBeenCalled();
    } finally {
      await ui.unmount();
    }
  } finally {
    AppState.currentState = previous;
    f.close();
  }
});
