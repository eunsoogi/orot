import { render, screen } from '@testing-library/react-native';
import { HistoryMemoryDetail } from '../HistoryMemoryDetail';
import type { ManualHistoryScreenRecord } from '../../manualHistory/types';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
const original: ManualHistoryScreenRecord = {
  id: 'synthetic-original',
  kind: 'note',
  title: 'Synthetic original',
  details: 'Synthetic details',
  effectiveDate: { status: 'unknown' },
  recordedAt: '2026-01-01T00:00:00Z',
  provenance: { origin: 'user_reported' },
  reviewState: { status: 'unreviewed' },
};
const corrected: ManualHistoryScreenRecord = {
  ...original,
  id: 'synthetic-corrected',
  title: 'Synthetic corrected',
  effectiveDate: { status: 'known', date: '2026-01-02' },
};

// Stable native targets must not change labels, selection or merge separate lineage AX nodes.
it.each([false, true])(
  'identifies current and lineage text with history=%s',
  async hasHistory => {
    const record = hasHistory ? corrected : original;
    const repository = {
      list: jest.fn(),
      create: jest.fn(),
      correct: jest.fn(),
      delete: jest.fn(),
      history: jest.fn(async () =>
        hasHistory ? [original, corrected] : [original],
      ),
    };
    await render(
      <HistoryMemoryDetail
        record={record}
        onChanged={jest.fn()}
        openRepository={async () => repository}
      />,
    );
    const title = screen.getByTestId('manual-history-current-title');
    expect(title.props.children).toBe(record.title);
    expect(title.props.selectable).toBe(true);
    expect(
      screen.getByTestId('manual-history-date-detail').props.children,
    ).toBe(hasHistory ? '기준일: 2026-01-02' : '기준일을 모름');
    if (hasHistory) {
      for (const version of [original, corrected]) {
        expect(
          screen.getByTestId('manual-history-title-version-' + version.id).props
            .children,
        ).toBe(version.title);
        expect(
          screen.getByTestId('manual-history-status-version-' + version.id)
            .props.children,
        ).toBe('직접 입력 · 미확인');
      }
      expect(screen.queryByTestId('manual-history-current-status')).toBeNull();
    } else {
      expect(
        screen.getByTestId('manual-history-current-status').props.children,
      ).toBe('직접 입력 · 미확인');
    }
    expect(repository.create).not.toHaveBeenCalled();
  },
);
