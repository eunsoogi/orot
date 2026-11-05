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
