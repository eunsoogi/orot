import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { subscribeRecapRetry } from '../../transcription/recapUpdates';
import { ConversationSavedRecaps } from '../ConversationSavedRecaps';
import {
  recapInput,
  recapResult,
} from '../../../../../packages/domain/__tests__/recap-fixtures';

const result = recapResult(recapInput());
jest.mock('@orot/storage', () => ({
  readCurrentRecapResult: jest.fn(),
  createVisitQuestionRecordRepository: jest.fn(() => ({
    listForAppointment: async () => [],
  })),
}));

it('requests a retry only for the displayed visit', async () => {
  const listener = jest.fn();
  const unsubscribe = subscribeRecapRetry(listener);
  const loadDatabase = async () => ({
    execute: async (query: string) => ({
      rows: query.includes('work_status')
        ? [{ work_status: 'save_failed' }]
        : [],
    }),
    transaction: async () => {},
  });
  await act(async () => {
    render(
      <ConversationSavedRecaps
        appointmentId="visit-a"
        loadDatabase={loadDatabase}
      />,
    );
  });
  await fireEvent.press(screen.getByText('진료 요약 다시 시도'));
  expect(listener).toHaveBeenCalledWith('visit-a');
  unsubscribe();
});

it('does not display a result belonging to another visit', async () => {
  const { readCurrentRecapResult } = require('@orot/storage');
  readCurrentRecapResult.mockResolvedValue(result);
  const loadDatabase = async () => ({
    execute: async (query: string) => ({
      rows: query.includes('work_status')
        ? []
        : [{ recording_id: 'recording-1' }],
    }),
    transaction: async () => {},
  });
  await act(async () => {
    render(
      <ConversationSavedRecaps
        appointmentId="different-visit"
        loadDatabase={loadDatabase}
      />,
    );
  });
  expect(readCurrentRecapResult).toHaveBeenCalled();
  expect(screen.queryByText('자동 저장된 진료 요약')).toBeNull();
});

it('shows a user correction separately from the AI result', async () => {
  const storage = require('@orot/storage');
  storage.readCurrentRecapResult.mockResolvedValue(result);
  storage.createVisitQuestionRecordRepository.mockReturnValueOnce({
    listForAppointment: async () => [
      {
        id: 'edited',
        questionId: result.questions[0].questionId,
        editOrigin: 'user_edit',
        answer: '직접 수정한 답변',
        automaticSource: { recordingSourceId: result.recordingSourceId },
      },
    ],
  });
  const loadDatabase = async () => ({
    execute: async (query: string) => ({
      rows: query.includes('work_status')
        ? []
        : [{ recording_id: result.recordingSourceId }],
    }),
    transaction: async () => {},
  });
  await act(async () => {
    render(
      <ConversationSavedRecaps
        appointmentId={result.appointmentId}
        loadDatabase={loadDatabase}
      />,
    );
  });
  expect(screen.getByText('내가 수정한 답변: 직접 수정한 답변')).toBeTruthy();
});

it('shows a saved result for its selected visit', async () => {
  const { readCurrentRecapResult } = require('@orot/storage');
  readCurrentRecapResult.mockResolvedValue(result);
  const loadDatabase = async () => ({
    execute: async (query: string) => ({
      rows: query.includes('work_status')
        ? []
        : [{ recording_id: result.recordingSourceId }],
    }),
    transaction: async () => {},
  });
  await act(async () => {
    render(
      <ConversationSavedRecaps
        appointmentId={result.appointmentId}
        loadDatabase={loadDatabase}
      />,
    );
  });
  expect(screen.getByText('자동 저장된 진료 요약')).toBeTruthy();
  expect(screen.getByText('이 전사에서 찾지 못했어요')).toBeTruthy();
});
