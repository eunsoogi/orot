import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { EvidenceSourceDetailScreen } from '../EvidenceSourceDetailScreen';
import type { EvidenceSourceReadResult } from '../evidenceRegistry';
import {
  createEvidenceVisualReader,
  evidenceVisualRecords,
  evidenceVisualReference,
} from '../../../../e2e/evidenceVisualFixtures';

const available = (
  document: Extract<
    EvidenceSourceReadResult,
    { status: 'available' }
  >['document'],
): EvidenceSourceReadResult => ({ status: 'available', document });

// Synthetic records exercise the production renderer, not a HealthKit read.
describe('source detail visual-state content', () => {
  it.each([
    ['medication', '1 정'],
    ['measurement', '70.5 kg'],
    ['activity', '2400 걸음'],
    ['sleep', '코어 수면'],
  ] as const)(
    'renders the saved %s value and event provenance',
    async (kind, value) => {
      await render(
        <EvidenceSourceDetailScreen
          reference={evidenceVisualReference}
          onBack={jest.fn()}
          readSource={createEvidenceVisualReader(kind)}
        />,
      );
      expect(await screen.findByText(value)).toBeTruthy();
      expect(screen.getByText('HealthKit')).toBeTruthy();
      expect(screen.getAllByText(/2026년 10월 20일/u).length).toBeGreaterThan(
        0,
      );
      const eventTime = new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(
        new Date(
          kind === 'sleep'
            ? '2026-10-20T01:00:00+09:00'
            : '2026-10-20T08:00:00+09:00',
        ),
      );
      const timeLabel =
        kind === 'medication'
          ? '복용 발생 시각'
          : kind === 'sleep'
            ? '측정 시작 시각'
            : '측정 시각';
      expect(screen.getByText(`${timeLabel} · ${eventTime}`)).toBeTruthy();
      if (kind === 'sleep') {
        const endTime = new Intl.DateTimeFormat('ko-KR', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        }).format(new Date('2026-10-20T02:30:00+09:00'));
        expect(screen.getByText(endTime)).toBeTruthy();
      }
      expect(screen.queryByText('앱 저장 시각')).toBeNull();
      expect(screen.queryByText('기록 시각')).toBeNull();
      if (kind === 'medication')
        expect(screen.getByText('합성 예시약')).toBeTruthy();
    },
  );

  it('selects the period measurement and retains its unit, window and time zone', async () => {
    await render(
      <EvidenceSourceDetailScreen
        reference={evidenceVisualReference}
        onBack={jest.fn()}
        readSource={createEvidenceVisualReader('period')}
      />,
    );
    expect(await screen.findByText('2026-10-01 ~ 2026-10-03')).toBeTruthy();
    expect(screen.getByText('Asia/Seoul')).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('tab', { name: '체중 · 측정 출처 2 3' }),
    );
    expect(
      screen.getByRole('tab', { name: '체중 · 측정 출처 2 3', selected: true }),
    ).toBeTruthy();
    expect(screen.getByText('70.5 kg')).toBeTruthy();
    expect(screen.getByText(/2026\. 10\. 2\./u)).toBeTruthy();
  });

  it.each(['missing', 'changed'] as const)(
    'renders the probe %s state',
    async status => {
      await render(
        <EvidenceSourceDetailScreen
          reference={evidenceVisualReference}
          onBack={jest.fn()}
          readSource={createEvidenceVisualReader(status)}
        />,
      );
      expect(
        await screen.findByTestId(`ai-feature-source-${status}`),
      ).toBeTruthy();
    },
  );

  it('renders the probe loading state and recovers its unavailable state', async () => {
    const view = await render(
      <EvidenceSourceDetailScreen
        reference={evidenceVisualReference}
        onBack={jest.fn()}
        readSource={createEvidenceVisualReader('loading')}
      />,
    );
    expect(screen.getByTestId('ai-feature-source-loading')).toBeTruthy();
    await view.rerender(
      <EvidenceSourceDetailScreen
        reference={evidenceVisualReference}
        onBack={jest.fn()}
        readSource={createEvidenceVisualReader('unavailable')}
      />,
    );
    expect(
      await screen.findByTestId('ai-feature-source-unavailable'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('ai-feature-source-retry'));
    expect(await screen.findByText('70.5 kg')).toBeTruthy();
  });

  it('shows loading until a read resolves and recovers after unavailable', async () => {
    let resolve!: (result: EvidenceSourceReadResult) => void;
    const readSource = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<EvidenceSourceReadResult>(done => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce(
        available({
          sourceKind: 'personal_record',
          records: [evidenceVisualRecords.measurement],
        }),
      );
    await render(
      <EvidenceSourceDetailScreen
        reference={evidenceVisualReference}
        onBack={jest.fn()}
        readSource={readSource}
      />,
    );
    expect(screen.getByTestId('ai-feature-source-loading')).toBeTruthy();
    await act(async () => resolve({ status: 'unavailable' }));
    expect(screen.getByTestId('ai-feature-source-unavailable')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('ai-feature-source-retry'));
    expect(await screen.findByText('70.5 kg')).toBeTruthy();
    expect(readSource).toHaveBeenCalledTimes(2);
  });

  it('ignores an obsolete retry after a new reference is selected', async () => {
    let resolveOld!: (result: EvidenceSourceReadResult) => void;
    const readSource = jest
      .fn()
      .mockResolvedValueOnce({ status: 'unavailable' })
      .mockImplementationOnce(
        () =>
          new Promise<EvidenceSourceReadResult>(done => {
            resolveOld = done;
          }),
      )
      .mockResolvedValueOnce({ status: 'missing' });
    const view = await render(
      <EvidenceSourceDetailScreen
        reference={evidenceVisualReference}
        onBack={jest.fn()}
        readSource={readSource}
      />,
    );
    expect(
      await screen.findByTestId('ai-feature-source-unavailable'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('ai-feature-source-retry'));
    expect(screen.getByTestId('ai-feature-source-loading')).toBeTruthy();
    await view.rerender(
      <EvidenceSourceDetailScreen
        reference={{ ...evidenceVisualReference, sourceId: 'new-source' }}
        onBack={jest.fn()}
        readSource={readSource}
      />,
    );
    expect(await screen.findByTestId('ai-feature-source-missing')).toBeTruthy();
    await act(async () =>
      resolveOld(
        available({
          sourceKind: 'personal_record',
          records: [evidenceVisualRecords.measurement],
        }),
      ),
    );
    expect(screen.getByTestId('ai-feature-source-missing')).toBeTruthy();
    expect(screen.queryByText('70.5 kg')).toBeNull();
  });
});
