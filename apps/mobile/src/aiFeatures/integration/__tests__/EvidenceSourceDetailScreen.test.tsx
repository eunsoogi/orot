import { fireEvent, render, screen } from '@testing-library/react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { LocalHealthEvidenceRecord } from '../../../healthEvidence/localEvidenceRepository';
import { EvidenceSourceDetailScreen } from '../EvidenceSourceDetailScreen';
import type { EvidenceSourceReadResult } from '../evidenceRegistry';

const reference: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'source-alias',
  sourceRevision: 'source-revision',
  evidenceId: 'evidence-alias',
  evidenceRevision: 'evidence-revision',
  locator: { kind: 'local-evidence', token: 'e1' },
  effectiveTime: '2026-01-02T08:00:00.000Z',
  reviewState: 'reviewed',
};

const savedRecords: readonly LocalHealthEvidenceRecord[] = [
  {
    kind: 'health_observation',
    record: {
      id: 'private-observation',
      effectiveAt: '2026-01-02T08:00:00.000Z',
      recordedAt: '2026-01-02T08:01:00.000Z',
      ingestedAt: '2026-01-02T08:02:00.000Z',
      provenance: {
        origin: 'imported',
        sourceRecordIds: ['private-source'],
        source: { system: 'healthkit' },
      },
      reviewState: {
        status: 'reviewed',
        reviewerId: 'private-reviewer',
        reviewedAt: '2026-01-03T08:00:00.000Z',
      },
      observationKind: 'measurement',
      concept: 'weight',
      value: { kind: 'quantity', amount: 70.5, unit: 'kg' },
    },
  },
  {
    kind: 'evidence_span',
    record: {
      id: 'private-span',
      sourceRecordId: 'opaque-source-id',
      text: '원문에 기록된 측정값',
      effectiveAt: '2026-01-02T08:00:00.000Z',
      recordedAt: '2026-01-02T08:00:00.000Z',
      ingestedAt: '2026-01-02T08:02:00.000Z',
      provenance: {
        origin: 'derived',
        sourceRecordIds: ['opaque-source-id'],
      },
      reviewState: { status: 'unreviewed' },
    },
  },
  {
    kind: 'source_record',
    record: {
      id: 'private-source',
      sourceKind: 'device_export',
      title: 'HealthKit import',
      effectiveAt: '2026-01-02T08:00:00.000Z',
      recordedAt: '2026-01-02T08:00:00.000Z',
      ingestedAt: '2026-01-02T08:02:00.000Z',
      provenance: { origin: 'imported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
    },
  },
];

describe('EvidenceSourceDetailScreen', () => {
  it('shows current saved values, units, times, and source provenance', async () => {
    const readSource = jest.fn(async (): Promise<EvidenceSourceReadResult> => ({
      status: 'available',
      document: { sourceKind: 'personal_record', records: savedRecords },
    }));
    const onBack = jest.fn();
    await render(
      <EvidenceSourceDetailScreen
        onBack={onBack}
        readSource={readSource}
        reference={reference}
      />,
    );

    expect(await screen.findByText('70.5 kg')).toBeTruthy();
    expectReferenceHeading();
    expect(screen.getAllByText(/2026년 1월 2일/u).length).toBeGreaterThan(0);
    expect(screen.getByText('HealthKit')).toBeTruthy();
    expect(screen.queryByText('원문에 기록된 측정값')).toBeNull();
    await fireEvent.press(screen.getByRole('tab', { name: '원문 발췌 2' }));
    expect(screen.getByText('원문에 기록된 측정값')).toBeTruthy();
    expect(screen.queryByText('70.5 kg')).toBeNull();
    await fireEvent.press(screen.getByRole('tab', { name: '저장된 출처 3' }));
    expect(screen.getByText('HealthKit import')).toBeTruthy();
    expect(screen.queryByText('private-observation')).toBeNull();
    expect(screen.queryByText('opaque-source-id')).toBeNull();
    await fireEvent.press(screen.getByTestId('ai-feature-source-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['changed', 'ai-feature-source-changed'],
    ['missing', 'ai-feature-source-missing'],
  ] as const)(
    'shows %s evidence state without rendering the old record payload',
    async (status, testId) => {
      const readSource = jest.fn(async () => ({ status }));
      await render(
        <EvidenceSourceDetailScreen
          onBack={jest.fn()}
          readSource={readSource}
          reference={reference}
        />,
      );

      expect(await screen.findByTestId(testId)).toBeTruthy();
      expectReferenceHeading();
      expect(screen.queryByText('70.5 kg')).toBeNull();
    },
  );
});

/** The selected reference has a larger title; preserve its weight and system text scaling. */
function expectReferenceHeading() {
  const heading = screen.getByRole('header', { name: '근거 살펴보기' });
  expect(heading).toHaveStyle({ fontSize: 36, fontWeight: '700' });
  expect(heading.props.allowFontScaling).not.toBe(false);
  expect(heading.props.numberOfLines).toBeUndefined();
}
