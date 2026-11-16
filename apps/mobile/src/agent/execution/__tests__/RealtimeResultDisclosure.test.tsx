import { fireEvent, render, screen } from '@testing-library/react-native';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import InferenceDisclosureSheet from '../InferenceDisclosureSheet';
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
const exactAnswer = 'Exact synthetic answer.\nNo silent rewriting.';
const request: OutboundProcessingRequest = {
  operationRunId: 'synthetic-result',
  providerId: 'openai-realtime',
  recipient: 'OpenAI',
  modelId: 'synthetic-realtime-model',
  remoteProcessing: true,
  allowedScope: { sourceKinds: ['personal_record'], sourceIds: [] },
  payload: {
    messages: [
      {
        role: 'user',
        content: exactAnswer,
      },
    ],
  },
  signal: new AbortController().signal,
};
it('expands exact one-shot result, identifies recipient and purpose, and does not imply remembered consent', async () => {
  const decide = jest.fn();
  await render(
    <InferenceDisclosureSheet request={request} onDecision={decide} />,
  );
  expect(screen.getByText(exactAnswer)).toBeTruthy();
  expect(screen.getByText('OpenAI')).toBeTruthy();
  expect(screen.getByText('synthetic-realtime-model')).toBeTruthy();
  expect(screen.getByText(/OpenAI Realtime 음성 응답을 위해/)).toBeTruthy();
  expect(
    screen.getByText(/이전의 목적별 허용은 이 전송에 적용하지 않아요/),
  ).toBeTruthy();
  expect(
    screen.getByTestId('inference-disclosure-expand').props.accessibilityState
      .expanded,
  ).toBe(true);
  expect(screen.getByText('이번 전송만 동의해요.')).toBeTruthy();
  expect(screen.queryByText('동의 내역은 설정에서 지울 수 있어요.')).toBeNull();
  expect(decide).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('inference-disclosure-cancel'));
  expect(decide).toHaveBeenCalledWith(false);
});
it('does not relabel scoped requests as one-shot Realtime transfers', async () => {
  await render(
    <InferenceDisclosureSheet
      request={{
        ...request,
        consentScope: {
          purpose: 'record_conversation',
          dataCategories: ['conversation'],
          policyVersion: 'synthetic',
        },
      }}
      onDecision={jest.fn()}
    />,
  );
  expect(screen.queryByText(/OpenAI Realtime 음성 응답을 위해/)).toBeNull();
  expect(
    screen.getByTestId('inference-disclosure-expand').props.accessibilityState
      .expanded,
  ).toBe(false);
});
