import { act, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { type HealthSummaryResult } from '../../ragConversation/healthSummary';
import {
  notifyLocalDataCleared,
  notifyLocalSourceDeleted,
} from '../../storage/localDataClearEvents';
import { openSavedGeneratedReportReferences } from '../openSavedGeneratedReportReferences';
import { SavedMemoryDetail } from '../SavedMemoryDetail';
import type { GeneratedReportSavedMemory } from '../unifiedSavedMemories';

jest.mock('../openSavedGeneratedReportReferences');

const row: GeneratedReportSavedMemory = {
  sourceKind: 'saved_generated_report',
  id: 'generated-report:synthetic',
  artifactId: 'synthetic',
  reportKind: 'health_summary',
  text: 'Synthetic report reference',
  createdAt: 1000,
};
const oldResult = { marker: 'old' } as unknown as HealthSummaryResult;

function heldReader() {
  const requests: Array<{
    isCurrent: () => boolean;
    resolve: (value: HealthSummaryResult | null) => void;
  }> = [];
  const read = jest.fn(
    (_artifactId: string, isCurrent: () => boolean) =>
      new Promise<HealthSummaryResult | null>(resolve => {
        requests.push({ isCurrent, resolve });
      }),
  );
  jest.mocked(openSavedGeneratedReportReferences).mockResolvedValue({
    readSavedHealthSummaryReference: read,
  } as unknown as Awaited<
    ReturnType<typeof openSavedGeneratedReportReferences>
  >);
  return requests;
}

function signal(state: 'background' | 'active') {
  jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1](state);
}

beforeEach(() => {
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
});

test.each([
  ['background', () => signal('background')],
  ['source deletion', () => notifyLocalSourceDeleted('local')],
  ['local clear', () => notifyLocalDataCleared()],
] as const)(
  'fences a held original synchronously on %s',
  async (_, invalidate) => {
    const requests = heldReader();
    await render(
      <SavedMemoryDetail memoryId={row.id} load={async () => [row]} />,
    );
    const request = requests[0]!;
    expect(request.isCurrent()).toBe(true);
    await act(async () => {
      invalidate();
      request.resolve(oldResult);
      // Child cleanup has not been flushed: the authoritative parent fence owns this.
      expect(request.isCurrent()).toBe(false);
    });
    expect(screen.queryByTestId('saved-generated-report-detail')).toBeNull();
  },
);

test('rapid foreground return with the same selected report cannot revive the original read', async () => {
  const requests = heldReader();
  const load = jest.fn(async () => [row]);
  await render(<SavedMemoryDetail memoryId={row.id} load={load} />);
  const first = requests[0]!;
  await act(async () => {
    signal('background');
    signal('active');
    first.resolve(oldResult);
    expect(first.isCurrent()).toBe(false);
  });
  expect(load).toHaveBeenCalledTimes(2);
  expect(requests).toHaveLength(2);
  expect(first.isCurrent()).toBe(false);
  expect(requests[1]!.isCurrent()).toBe(true);
  await act(async () => requests[1]!.resolve(null));
  expect(screen.getByRole('alert')).toBeTruthy();
});
