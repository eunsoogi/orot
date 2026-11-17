import { fireEvent, render, screen } from '@testing-library/react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
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

test('quarantined research hides the original and returns to explicit new-request entry without dispatch', async () => {
  const onBack = jest.fn();
  const readSource = jest.fn(async (): Promise<EvidenceSourceReadResult> => ({
    status: 'unavailable',
    reason: 'unverifiable_legacy_period',
  }));
  await render(
    <EvidenceSourceDetailScreen
      onBack={onBack}
      readSource={readSource}
      reference={reference}
    />,
  );
  expect(
    await screen.findByText(
      '이전 조사에 쓰인 건강 기록을 확인할 수 없어 원문과 AI 재사용을 차단했어요. 저장 자료는 보존되어 있어요. 이전 화면에서 최신 기록으로 새 조사를 요청해 주세요.',
    ),
  ).toBeTruthy();
  expect(screen.queryByText('70.5 kg')).toBeNull();
  await fireEvent.press(screen.getByText('돌아가서 새 조사 요청'));
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(readSource).toHaveBeenCalledTimes(1);
});
