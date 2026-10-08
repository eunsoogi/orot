import { fireEvent, render, screen } from '@testing-library/react-native';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import type { LanguageModelInputPart } from '@orot/model-runtime';
import InferenceDisclosureSheet from '../InferenceDisclosureSheet';

function request(
  content:
    | string
    | readonly LanguageModelInputPart[] = 'Synthetic health value 120/80.',
): OutboundProcessingRequest {
  return {
    operationRunId: 'private-run-id',
    providerId: 'private-provider-id',
    modelId: 'selected-model',
    recipient: 'selected-account',
    remoteProcessing: true,
    allowedScope: {
      sourceKinds: ['personal_record'],
      sourceIds: ['private-source-id', 'synthetic-oauth-secret'],
    },
    payload: { messages: [{ role: 'user', content }] },
    signal: new AbortController().signal,
  };
}

describe('InferenceDisclosureSheet', () => {
  it('shows the exact model input and destination without local registry metadata', async () => {
    const selected = request();
    const onDecision = jest.fn();

    await render(
      <InferenceDisclosureSheet request={selected} onDecision={onDecision} />,
    );

    expect(screen.getByText('Synthetic health value 120/80.')).toBeTruthy();
    expect(screen.getByText('서비스: private-provider-id')).toBeTruthy();
    expect(screen.getByText('받는 곳: selected-account')).toBeTruthy();
    expect(screen.getByText('모델: selected-model')).toBeTruthy();
    expect(screen.queryByText(/private-run-id/u)).toBeNull();
    expect(
      screen.queryByText(/private-source-id|synthetic-oauth-secret/u),
    ).toBeNull();

    fireEvent.press(screen.getByTestId('inference-disclosure-allow'));
    expect(onDecision).toHaveBeenCalledWith(true);
  });

  it('blocks approval when an attachment cannot be previewed', async () => {
    const selected = request([
      {
        type: 'image',
        data: new Uint8Array([1, 2, 3]),
        mediaType: 'image/png',
      },
    ]);

    await render(
      <InferenceDisclosureSheet request={selected} onDecision={jest.fn()} />,
    );

    expect(
      screen.getByText(
        /첨부 내용을 미리 볼 수 없어 전송을 허용할 수 없습니다/u,
      ),
    ).toBeTruthy();
    expect(
      screen.getByTestId('inference-disclosure-allow').props.accessibilityState
        .disabled,
    ).toBe(true);
  });

  it('shows tool input, results, schemas, and output settings from the request', async () => {
    const base = request();
    const selected: OutboundProcessingRequest = {
      ...base,
      payload: {
        messages: [
          { role: 'user', content: 'Synthetic request.' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'synthetic-tool-call-id',
                name: 'lookup_visit',
                arguments: { query: 'synthetic query' },
              },
            ],
          },
          {
            role: 'tool',
            toolCallId: 'synthetic-tool-call-id',
            result: { match: 'synthetic result' },
          },
        ],
        tools: [
          {
            name: 'lookup_visit',
            inputSchema: {
              type: 'object',
              properties: { query: { type: 'string' } },
            },
          },
        ],
        responseFormat: {
          name: 'classification',
          schema: { type: 'object', required: ['classification'] },
        },
        maxOutputTokens: 256,
        temperature: 0.2,
      },
    };

    await render(
      <InferenceDisclosureSheet request={selected} onDecision={jest.fn()} />,
    );

    expect(
      screen.getAllByText(/synthetic-tool-call-id/u).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/synthetic result/u)).toBeTruthy();
    expect(screen.getAllByText(/lookup_visit/u).length).toBeGreaterThan(0);
    expect(screen.getByText(/maxOutputTokens/u)).toBeTruthy();
    expect(screen.getByText(/classification/u)).toBeTruthy();
  });
});
