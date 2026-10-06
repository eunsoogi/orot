import { fireEvent, render, screen } from '@testing-library/react-native';
import type {
  VisitQuestionCandidate,
  VisitQuestionEvidenceItem,
} from '../taskContract';
import { VisitQuestionReview } from '../VisitQuestionReview';

const evidence: VisitQuestionEvidenceItem = {
  sourceKind: 'personal_record',
  sourceId: 'source-1',
  sourceRevision: 'revision-1',
  evidenceId: 'span-1',
  evidenceRevision: 'evidence-revision-1',
  locator: { kind: 'text_range', startOffset: 0, endOffset: 16 },
  effectiveTime: '2026-10-01T00:00:00Z',
  reviewState: 'reviewed' as const,
  content: 'Synthetic reviewed evidence',
};

const questions: readonly VisitQuestionCandidate[] = [
  {
    questionText: '이 기록을 진료에서 어떻게 확인하면 좋을까요?',
    rationale: '최근 기록을 의료진과 함께 확인할 수 있어요.',
    priority: 'routine',
    citations: [evidence],
  },
  {
    questionText: '이 결과의 의미를 어떻게 이해하면 좋을까요?',
    rationale: '검사 결과를 의료진에게 직접 물어볼 수 있어요.',
    priority: 'important',
    citations: [evidence],
  },
];

describe('VisitQuestionReview', () => {
  it('lets the user edit, reprioritize, reorder, and confirm a source-linked list', async () => {
    const onConfirm = jest.fn();
    await render(
      <VisitQuestionReview
        appointmentLabel="Synthetic outpatient visit · 2026-11-01"
        memoryStatus="no_matching_current_memory"
        questions={questions}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getAllByText('Synthetic reviewed evidence')).toHaveLength(2);
    await fireEvent.changeText(
      screen.getByLabelText('질문 1'),
      '이 검사를 다음 진료에서 어떻게 확인하면 좋을까요? ',
    );
    await fireEvent.press(screen.getByTestId('visit-question-priority-0'));
    await fireEvent.press(screen.getByTestId('visit-question-move-down-0'));
    await fireEvent.press(screen.getByTestId('visit-question-confirm'));

    expect(onConfirm).toHaveBeenCalledWith([
      questions[1],
      {
        ...questions[0],
        questionText: '이 검사를 다음 진료에서 어떻게 확인하면 좋을까요?',
        priority: 'important',
      },
    ]);
  });

  it('does not let an incomplete draft be saved', async () => {
    await render(
      <VisitQuestionReview
        appointmentLabel="Synthetic outpatient visit"
        questions={[{ ...questions[0]!, rationale: '' }]}
        onConfirm={jest.fn()}
      />,
    );

    expect(
      screen.getByTestId('visit-question-confirm').props.accessibilityState
        .disabled,
    ).toBe(true);
  });
});
