import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { EvidenceSourceDetailScreen } from '../EvidenceSourceDetailScreen';
import type { EvidenceSourceReadResult } from '../evidenceRegistry';

const reference: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'synthetic-opaque',
  sourceRevision: 'synthetic-revision',
  evidenceId: 'synthetic-evidence',
  evidenceRevision: 'synthetic-evidence-revision',
  locator: { kind: 'local-evidence', token: 'e1' },
  effectiveTime: '2026-01-02T08:00:00.000Z',
  reviewState: 'reviewed',
};

const owner = {
  sessionId: 'synthetic-session',
  sessionVersion: 0,
  requestId: 'synthetic-request',
  operationRunId: 'synthetic-run',
};
const header = 'ai-feature-source-heading';
const loading = 'ai-feature-source-loading';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test.each([false, true])(
  'commits generic local evidence scaffold before any held detail resolver (cold: %s)',
  async cold => {
    let settle: (value: EvidenceSourceReadResult) => void = () => {};
    const held = new Promise<EvidenceSourceReadResult>(
      resolve => (settle = resolve),
    );
    const readSource = jest.fn(() => held);
    const readColdSource = jest.fn(() => held);
    await render(
      <EvidenceSourceDetailScreen
        reference={reference}
        sourceOwner={cold ? owner : undefined}
        readSource={readSource}
        readColdSource={readColdSource}
        onBack={jest.fn()}
      />,
    );
    expect(screen.getByTestId(header)).toBeVisible();
    expect(screen.getByTestId(loading)).toBeVisible();
    expect(readSource).not.toHaveBeenCalled();
    expect(readColdSource).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId(header), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 280, height: 18 } },
    });
    expect(cold ? readColdSource : readSource).toHaveBeenCalledTimes(1);
    expect(cold ? readSource : readColdSource).not.toHaveBeenCalled();
    expect(screen.getByTestId(loading)).toBeVisible();
    await act(() => {
      settle({ status: 'changed' });
    });
    expect(screen.queryByTestId(loading)).toBeNull();
    expect(screen.getByTestId('ai-feature-source-changed')).toBeVisible();
  },
);

test('bounded fallback starts once if the header receipt is missing, but never after close', async () => {
  const readSource = jest.fn(async () => ({ status: 'missing' as const }));
  const mount = () =>
    render(
      <EvidenceSourceDetailScreen
        reference={reference}
        readSource={readSource}
        onBack={jest.fn()}
      />,
    );
  const closed = await mount();
  await closed.unmount();
  await act(() => jest.advanceTimersByTime(160));
  expect(readSource).not.toHaveBeenCalled();

  const view = await mount();
  expect(screen.getByTestId(loading)).toBeVisible();
  await act(() => jest.advanceTimersByTime(159));
  expect(readSource).not.toHaveBeenCalled();
  await act(() => jest.advanceTimersByTime(1));
  expect(readSource).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('ai-feature-source-missing')).toBeVisible();
  await view.rerender(
    <EvidenceSourceDetailScreen
      reference={{ ...reference, sourceId: 'replacement' }}
      readSource={readSource}
      onBack={jest.fn()}
    />,
  );
  expect(readSource).toHaveBeenCalledTimes(2);
});
