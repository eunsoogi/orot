import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { LanguageModelInputPart } from '@orot/model-runtime';
import InferenceDisclosureSheet from '../InferenceDisclosureSheet';
import { appColors } from '../../../layout/appColors';

/** Provides the caller's safe-area context so the sheet's nested Modal provider can initialize in Jest. */
async function renderWithSafeArea(children: ReactNode) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 430, height: 800 },
        insets: { top: 0, right: 0, bottom: 24, left: 0 },
      }}
    >
      {children}
    </SafeAreaProvider>,
  );
}

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
  it('keeps a visible top grabber outside scrolling content without intercepting native gestures', async () => {
    const onDecision = jest.fn();
    await renderWithSafeArea(
      <InferenceDisclosureSheet request={request()} onDecision={onDecision} />,
    );
    const grabber = screen.getByTestId('inference-disclosure-grabber', {
      includeHiddenElements: true,
    });
    expect(grabber).toHaveStyle({
      marginTop: 6,
      marginBottom: 8,
      alignSelf: 'center',
      width: 36,
      height: 5,
      backgroundColor: appColors.secondary,
    });
    expect(grabber.props.pointerEvents).toBe('none');
    expect(grabber.props.accessibilityElementsHidden).toBe(true);
    expect(onDecision).not.toHaveBeenCalled();
  });
  it('immediately previews unclassified web text and makes no reusable-consent promise', async () => {
    await renderWithSafeArea(
      <InferenceDisclosureSheet
        request={{
          ...request('Synthetic unclassified exact query'),
          consentScope: {
            purpose: 'public_web_search',
            dataCategories: ['public_web_search_terms'],
            policyVersion: 'controlled-public-topics-v2',
          },
        }}
        canRemember={false}
        onDecision={jest.fn()}
      />,
    );
    expect(screen.getByText('Synthetic unclassified exact query')).toBeTruthy();
    expect(
      screen.getByTestId('inference-disclosure-expand').props.accessibilityState
        .expanded,
    ).toBe(true);
  });
  it('discloses the selected model and exact public-web query without claiming to send record originals', async () => {
    await renderWithSafeArea(
      <InferenceDisclosureSheet
        request={{
          ...request('Synthetic public topic'),
          providerId: 'chatgpt-plan:synthetic:gpt-6-luna',
          modelId: 'gpt-6-luna',
          consentScope: {
            purpose: 'public_web_search',
            dataCategories: ['public_web_search_terms'],
            policyVersion: 'isolated-public-query-v1',
          },
        }}
        onDecision={jest.fn()}
      />,
    );
    expect(screen.getByText('공개 웹검색어')).toBeTruthy();
    expect(screen.getByText('GPT-6-Luna')).toBeTruthy();
    expect(screen.queryByText('Synthetic public topic')).toBeNull();
    await fireEvent.press(screen.getByTestId('inference-disclosure-expand'));
    expect(screen.getByText('Synthetic public topic')).toBeTruthy();
  });
  it('uses a native downward-dismissible sheet and treats dismissal as cancellation', async () => {
    const onDecision = jest.fn();
    await renderWithSafeArea(
      <InferenceDisclosureSheet request={request()} onDecision={onDecision} />,
    );
    const modal = screen.getByTestId('inference-disclosure-modal');
    expect(modal.props.presentationStyle).toBe('pageSheet');
    expect(modal.props.allowSwipeDismissal).toBe(true);
    expect(modal.props.transparent).not.toBe(true);
    await fireEvent(modal, 'requestClose');
    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith(false);
  });
  it('describes a reusable public-search permission without presenting Europe PMC as an AI model', async () => {
    await renderWithSafeArea(
      <InferenceDisclosureSheet
        request={{
          ...request('synthetic search terms'),
          providerId: 'europe-pmc',
          modelId: 'public-medical-search',
          recipient: 'Europe PMC',
          consentScope: {
            purpose: 'public_medical_search',
            dataCategories: ['medical_search_terms'],
            policyVersion: 'public-query-v1',
          },
        }}
        onDecision={jest.fn()}
      />,
    );
    expect(screen.getByText('Europe PMC')).toBeTruthy();
    expect(screen.getByText('증상·약·검사에 관한 검색어')).toBeTruthy();
    expect(screen.queryByText('사용할 AI')).toBeNull();
    expect(screen.queryByText('synthetic search terms')).toBeNull();
    await fireEvent.press(screen.getByTestId('inference-disclosure-expand'));
    expect(screen.getByText('synthetic search terms')).toBeTruthy();
  });

  it('shows the exact model input and destination without local registry metadata', async () => {
    const selected = request();
    const onDecision = jest.fn();

    await renderWithSafeArea(
      <InferenceDisclosureSheet request={selected} onDecision={onDecision} />,
    );

    expect(screen.queryByText('Synthetic health value 120/80.')).toBeNull();
    await fireEvent.press(screen.getByTestId('inference-disclosure-expand'));
    expect(screen.getByText('Synthetic health value 120/80.')).toBeTruthy();
    expect(screen.getByText('private-provider-id')).toBeTruthy();
    expect(screen.getByText('selected-account')).toBeTruthy();
    expect(screen.getByText('selected-model')).toBeTruthy();
    expect(screen.queryByText(/private-run-id/u)).toBeNull();
    expect(
      screen.queryByText(/private-source-id|synthetic-oauth-secret/u),
    ).toBeNull();

    await fireEvent.press(screen.getByTestId('inference-disclosure-allow'));
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

    await renderWithSafeArea(
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

    await renderWithSafeArea(
      <InferenceDisclosureSheet request={selected} onDecision={jest.fn()} />,
    );

    await fireEvent.press(screen.getByTestId('inference-disclosure-expand'));
    expect(
      screen.getAllByText(/synthetic-tool-call-id/u).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/synthetic result/u)).toBeTruthy();
    expect(screen.getAllByText(/lookup_visit/u).length).toBeGreaterThan(0);
    expect(screen.getByText(/maxOutputTokens/u)).toBeTruthy();
    expect(screen.getByText(/classification/u)).toBeTruthy();
  });
});
