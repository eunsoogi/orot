import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ManualVisitRecords } from '../ManualVisitRecords';
import type {
  ManualVisitQuestion,
  ManualVisitRecords as Service,
} from '../manualVisitRecordService';

const prepared = {
  question: {
    id: 'question-1',
    questionText: '진료 때 확인할 질문은 무엇인가요?',
  },
  revision: 'v1:1',
  records: [],
} as unknown as ManualVisitQuestion;

test('offers an accessible action and keeps a new confirmation visibly pending', async () => {
  const service = {
    load: jest.fn().mockResolvedValue([prepared]),
    saveManual: jest.fn(),
    edit: jest.fn(),
  } as unknown as Service;
  await render(
    <ManualVisitRecords appointmentId="visit-1" open={async () => service} />,
  );

  const confirm = await screen.findByRole('button', {
    name: '실제로 물어봤어요',
  });
  expect(confirm.props.accessibilityState).toMatchObject({
    disabled: false,
    busy: false,
  });
  expect(StyleSheet.flatten(confirm.props.style)).toMatchObject({
    minHeight: 44,
    minWidth: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
  });
  await fireEvent.press(confirm);

  expect(
    await screen.findByText(
      '아직 저장되지 않았어요. 답변을 저장해야 질문 완료로 기록돼요.',
    ),
  ).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: '실제로 물어봤어요' }),
  ).toBeNull();
  expect(service.saveManual).not.toHaveBeenCalled();
});

test('shows a busy save state once and restores the checked completion after readback', async () => {
  let resolveSave!: (value: unknown) => void;
  const pendingSave = new Promise<unknown>(resolve => {
    resolveSave = resolve;
  });
  const confirmed = {
    ...prepared,
    records: [
      {
        id: 'record-1',
        revision: 1,
        sourceMethod: 'manual_confirmed',
        editOrigin: 'manual_confirmation',
        answer: null,
      },
    ],
  } as unknown as ManualVisitQuestion;
  const saveManual = jest.fn().mockReturnValue(pendingSave);
  const service = {
    load: jest
      .fn()
      .mockResolvedValueOnce([prepared])
      .mockResolvedValueOnce([confirmed]),
    saveManual,
    edit: jest.fn(),
  } as unknown as Service;
  await render(
    <ManualVisitRecords appointmentId="visit-1" open={async () => service} />,
  );

  await fireEvent.press(
    await screen.findByRole('button', { name: '실제로 물어봤어요' }),
  );
  await fireEvent.press(screen.getByRole('button', { name: '저장' }));
  const saving = screen.getByRole('button', { name: '저장 중' });
  expect(saving.props.accessibilityState).toMatchObject({
    busy: true,
    disabled: true,
  });
  expect(screen.getByText('질문 확인을 저장하고 있어요.')).toBeTruthy();
  await fireEvent.press(saving);
  expect(service.saveManual).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveSave({});
  });
  await waitFor(() =>
    expect(screen.getByText('질문을 물어봤어요')).toBeTruthy(),
  );
  const complete = screen.getByRole('checkbox', {
    name: '질문을 물어봤어요',
  });
  expect(complete.props.accessibilityState).toMatchObject({
    checked: true,
    disabled: true,
  });
  expect(StyleSheet.flatten(complete.props.style)).toMatchObject({
    maxWidth: '100%',
  });
  expect(
    StyleSheet.flatten(screen.getByText('질문을 물어봤어요').props.style),
  ).toMatchObject({ flexShrink: 1 });
  expect(
    screen.queryByRole('button', { name: '실제로 물어봤어요' }),
  ).toBeNull();
});
