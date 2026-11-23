import { act, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { GeneratedReportDetailDestination } from '../GeneratedReportDetailDestination';
import {
  createGeneratedReportReader,
  openGeneratedReportReader,
} from '../readers';
import { quarantinedHistoryFixture } from '../../aiFeatures/integration/testSupport/quarantinedHistoryFixture';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';

jest.mock('../readers', () => ({
  ...jest.requireActual('../readers'),
  openGeneratedReportReader: jest.fn(),
}));

test('a validated saved Health Summary opens through Records with shared section headings, without live source actions', async () => {
  const f = await quarantinedHistoryFixture();
  const phase = AppState.currentState;
  AppState.currentState = 'active';
  try {
    const reader = createGeneratedReportReader(f.database, {
      data: f.input.loadLocalData,
      records: async () => f.repository,
    });
    jest.mocked(openGeneratedReportReader).mockResolvedValue(reader);
    const row = (await reader.list()).find(item => item.id === f.saved.id)!;
    expect(row.kind).toBe('health_summary');
    const openCitation = jest.fn();
    const view = await render(
      <GeneratedReportDetailDestination
        active
        row={row}
        openReportSource={openCitation}
      />,
    );
    try {
      const title = await screen.findByRole('header', { name: '심박 기록' });
      expect(title).toBeVisible();
      expect(
        screen.getByText('심박수 128 count/min 기록이 있어요.'),
      ).toBeVisible();
      expect(screen.queryByTestId('generated-report-paragraph-0')).toBeNull();
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.queryByTestId('health-summary-period')).toBeNull();
      expect(openCitation).not.toHaveBeenCalled();
      await act(async () => {
        await f.quarantine();
        notifyLocalSourceDeleted();
      });
      expect(
        await screen.findByText('현재 열 수 없는 자료예요.'),
      ).toBeVisible();
      expect(screen.queryByText('심박 기록')).toBeNull();
      expect(openCitation).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  } finally {
    AppState.currentState = phase;
    f.close();
  }
});
