import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { ManualVisitRecords } from '../ManualVisitRecords';
import type {
  ManualVisitQuestion,
  ManualVisitRecords as Service,
} from '../manualVisitRecordService';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { act } from '@testing-library/react-native';

const item = {
  question: { id: 'question-1', questionText: '언제 복용하나요?' },
  revision: 'v1:1',
  records: [],
} as unknown as ManualVisitQuestion;

test('does not save a prepared question until the user confirms and saves; cancel leaves it unchanged', async () => {
  const service = {
    load: jest.fn().mockResolvedValue([item]),
    saveManual: jest.fn().mockResolvedValue({}),
    edit: jest.fn(),
  } as unknown as Service;
  await render(
    <ManualVisitRecords appointmentId="visit-1" open={async () => service} />,
  );
  await screen.findByText('언제 복용하나요?');
  expect(service.saveManual).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('실제로 물어봤어요'));
  await fireEvent.changeText(
    screen.getByLabelText('의료진 답변'),
    '식후에 복용해요',
  );
  await fireEvent.press(screen.getByText('취소'));
  expect(service.saveManual).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('실제로 물어봤어요'));
  await fireEvent.press(screen.getByText('저장'));
  await waitFor(() =>
    expect(service.saveManual).toHaveBeenCalledWith({
      appointmentId: 'visit-1',
      questionId: 'question-1',
      expectedQuestionRevision: 'v1:1',
      answer: null,
    }),
  );
});

test('keeps the draft visible when saving fails', async () => {
  const service = {
    load: jest.fn().mockResolvedValue([item]),
    saveManual: jest.fn().mockRejectedValue(new Error('unavailable')),
    edit: jest.fn(),
  } as unknown as Service;
  await render(
    <ManualVisitRecords appointmentId="visit-1" open={async () => service} />,
  );
  await screen.findByText('언제 복용하나요?');
  await fireEvent.press(screen.getByText('실제로 물어봤어요'));
  await fireEvent.changeText(screen.getByLabelText('의료진 답변'), '식후');
  await fireEvent.press(screen.getByText('저장'));
  await screen.findByText(
    '저장 결과를 확인하지 못했어요. 다시 불러와 확인해 주세요.',
  );
  expect(screen.getByLabelText('의료진 답변').props.value).toBe('식후');
});

test('opens a saved answer for editing with its expected record revision', async () => {
  const saved = {
    ...item,
    records: [
      {
        id: 'record-1',
        revision: 2,
        sourceMethod: 'manual_confirmed',
        editOrigin: 'user_edit',
        answer: '기존 답변',
      },
    ],
  } as unknown as ManualVisitQuestion;
  const service = {
    load: jest.fn().mockResolvedValue([saved]),
    saveManual: jest.fn(),
    edit: jest.fn().mockResolvedValue({}),
  } as unknown as Service;
  await render(
    <ManualVisitRecords appointmentId="visit-1" open={async () => service} />,
  );
  await screen.findByText('기존 답변');
  expect(screen.getByText('사용자가 수정한 답변')).toBeTruthy();
  await fireEvent.press(screen.getByText('답변 수정'));
  await fireEvent.changeText(
    screen.getByLabelText('의료진 답변'),
    '수정된 답변',
  );
  await fireEvent.press(screen.getByText('저장'));
  await waitFor(() =>
    expect(service.edit).toHaveBeenCalledWith({
      id: 'record-1',
      expectedRevision: 2,
      answer: '수정된 답변',
    }),
  );
  expect(service.saveManual).not.toHaveBeenCalled();
});

test.each(['not_found', 'indeterminate'] as const)(
  'does not present %s AI results as found or clinician-confirmed',
  async status => {
    const saved = {
      ...item,
      records: [
        {
          id: 'ai-1',
          revision: 1,
          sourceMethod: 'ai_generated',
          editOrigin: 'ai_analysis',
          answer: null,
          automaticSource: { result: { status, answers: [] } },
        },
      ],
    } as unknown as ManualVisitQuestion;
    const service = {
      load: jest.fn().mockResolvedValue([saved]),
      saveManual: jest.fn(),
      edit: jest.fn(),
    } as unknown as Service;
    await render(
      <ManualVisitRecords appointmentId="visit-1" open={async () => service} />,
    );
    await screen.findByText('언제 복용하나요?');
    expect(screen.queryByText('녹음에서 찾은 내용')).toBeNull();
    expect(
      screen.getByText(
        status === 'not_found'
          ? '이 전사에서 질문 근거를 찾지 못했어요.'
          : '질문 여부가 불확실해요.',
      ),
    ).toBeTruthy();
  },
);

test('shows the confirmed question wording when the prepared question changes', async () => {
  const saved = {
    ...item,
    question: { ...item.question, questionText: '새 질문' },
    records: [
      {
        id: 'r',
        revision: 1,
        questionText: '기존 질문',
        sourceMethod: 'manual_confirmed',
        editOrigin: 'manual_confirmation',
        answer: '기존 답변',
      },
    ],
  } as unknown as ManualVisitQuestion;
  const service = {
    load: jest.fn().mockResolvedValue([saved]),
    saveManual: jest.fn(),
    edit: jest.fn(),
  } as unknown as Service;
  await render(
    <ManualVisitRecords appointmentId="visit-1" open={async () => service} />,
  );
  await screen.findByText('기존 답변');
  expect(screen.getByText('기존 질문')).toBeTruthy();
});

test('clears deleted source content and revalidates the visible list', async () => {
  const load = jest
    .fn()
    .mockResolvedValueOnce([item])
    .mockResolvedValueOnce([]);
  const service = {
    load,
    saveManual: jest.fn(),
    edit: jest.fn(),
  } as unknown as Service;
  await render(
    <ManualVisitRecords appointmentId="visit-1" open={async () => service} />,
  );
  await screen.findByText('언제 복용하나요?');
  await act(async () => {
    notifyLocalSourceDeleted();
  });
  await waitFor(() =>
    expect(screen.queryByText('언제 복용하나요?')).toBeNull(),
  );
  expect(load).toHaveBeenCalledTimes(2);
});
