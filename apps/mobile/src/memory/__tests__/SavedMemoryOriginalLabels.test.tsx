import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { type ComponentProps } from 'react';
import { AppState } from 'react-native';
import type { MaterialLibraryRow } from '../../layout/MaterialLibraryRows';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import type { ManualHistoryScreenRecord } from '../../manualHistory/types';
import { SavedMemoryBrowser } from '../SavedMemoryBrowser';
import { unifySavedMemories } from '../unifiedSavedMemories';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
const mockRowPress = new Map<string, () => void>();
jest.mock('../../layout/MaterialLibraryRows', () => {
  const original = jest.requireActual<
    typeof import('../../layout/MaterialLibraryRows')
  >('../../layout/MaterialLibraryRows');
  return {
    ...original,
    MaterialLibraryRow: (props: ComponentProps<typeof MaterialLibraryRow>) => {
      if (props.onPress) mockRowPress.set(props.testID, props.onPress);
      return <original.MaterialLibraryRow {...props} />;
    },
  };
});

const undated: ManualHistoryScreenRecord = {
  id: 'synthetic-undated',
  kind: 'note',
  title: 'Synthetic undated original',
  details: 'Synthetic undated history',
  effectiveDate: { status: 'unknown' },
  recordedAt: '2026-01-04T00:00:00Z',
  provenance: { origin: 'user_reported' },
  reviewState: { status: 'unreviewed' },
};
const corrected = {
  ...undated,
  id: 'synthetic-corrected',
  title: 'Synthetic corrected original',
  effectiveDate: { status: 'known', date: '2025-12-30' } as const,
  reviewState: { status: 'needs_review' } as const,
  supersedesId: 'synthetic-earlier',
};
const agent = {
  id: 'synthetic-agent',
  kind: 'preference' as const,
  text: 'Synthetic independent preference',
  createdAt: Date.parse('2026-01-03T00:00:00Z'),
  provenance: { sourceIds: [], reviewState: 'user_confirmed' as const },
};
const projected = {
  ...agent,
  id: 'synthetic-projection',
  text: 'Synthetic projection duplicate',
  provenance: {
    ...agent.provenance,
    sourceIds: [corrected.id],
    sourceReferences: [{ kind: 'manual_history', id: corrected.id }],
  },
};

it('shows original dates and review labels without duplicating or retargeting corrected history', async () => {
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
  const open = jest.fn();
  const load = jest.fn(async () =>
    unifySavedMemories([agent, projected], [undated, corrected]),
  );
  await render(<SavedMemoryBrowser load={load} onOpenMemory={open} />);
  expect(screen.getByText('기준일을 모름 · 직접 입력 · 미확인')).toBeTruthy();
  expect(
    screen.getByText('기준일: 2025-12-30 · 직접 입력 · 확인 필요'),
  ).toBeTruthy();
  expect(screen.getByText(/^저장:/u)).toBeTruthy();
  expect(screen.queryByText(projected.text)).toBeNull();
  const correctedRowId = 'saved-memory-entry-manual-history:' + corrected.id;
  const correctedRow = screen.getByTestId(correctedRowId);
  await fireEvent.press(correctedRow);
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenLastCalledWith('manual-history:' + corrected.id);
  const queued = mockRowPress.get(correctedRowId);
  expect(queued).toBeDefined();
  await act(async () => notifyLocalSourceDeleted('local'));
  await act(async () => queued?.());
  expect(screen.queryByText(/기준일/u)).toBeNull();
  expect(screen.queryByTestId(correctedRowId)).toBeNull();
  expect(open).toHaveBeenCalledTimes(1);
});
