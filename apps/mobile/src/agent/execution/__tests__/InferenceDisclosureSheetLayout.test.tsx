import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import InferenceDisclosureSheet from '../InferenceDisclosureSheet';
import { t } from '../../../i18n';

/** Sends measured panel bounds through the Modal-owned sheet's layout callback. */
function disclosureRequest(): OutboundProcessingRequest {
  return {
    operationRunId: 'synthetic-run',
    providerId: 'synthetic-provider',
    modelId: 'synthetic-model',
    recipient: 'Synthetic destination',
    remoteProcessing: true,
    allowedScope: {
      sourceKinds: ['personal_record'],
      sourceIds: ['synthetic-source'],
    },
    payload: { messages: [{ role: 'user', content: 'Synthetic request.' }] },
    signal: new AbortController().signal,
  };
}

test('reflows from measured modal geometry while keeping the consent summary and actions reachable', async () => {
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 430, height: 800 },
        insets: { top: 0, right: 0, bottom: 24, left: 0 },
      }}
    >
      <InferenceDisclosureSheet
        request={disclosureRequest()}
        onDecision={jest.fn()}
      />
    </SafeAreaProvider>,
  );

  const modal = screen.getByTestId('inference-disclosure-modal');
  const safeArea = screen.getByTestId('inference-disclosure-modal-safe-area');
  const window = screen.getByTestId('inference-disclosure-sheet');
  const recipientCard = screen.getByTestId(
    'inference-disclosure-recipient-card',
  );
  const scopeCard = screen.getByTestId('inference-disclosure-scope-card');
  const summary = screen.getByTestId('inference-disclosure-summary');
  const footer = screen.getByTestId('inference-disclosure-footer');
  const content = screen.getByTestId('inference-disclosure-content');
  const grabber = screen.getByTestId('inference-disclosure-grabber', {
    includeHiddenElements: true,
  });

  expect(modal.props.presentationStyle).toBe('pageSheet');
  expect(content.props.stickyHeaderIndices).toBeUndefined();
  expect(
    within(summary).getByTestId('inference-disclosure-recipient-card'),
  ).toBeTruthy();
  expect(
    within(summary).getByTestId('inference-disclosure-scope-card'),
  ).toBeTruthy();
  expect(
    within(recipientCard).getByTestId('inference-disclosure-recipient'),
  ).toBeTruthy();
  expect(
    within(scopeCard).getByTestId('inference-disclosure-scope'),
  ).toBeTruthy();
  expect(within(footer).getAllByRole('button')).toHaveLength(2);
  expect(
    within(content).getByTestId('inference-disclosure-footer'),
  ).toBeTruthy();

  // The Modal inset wins over the caller's larger value while the footer keeps its minimum padding.
  await fireEvent(safeArea, 'insetsChange', {
    nativeEvent: {
      frame: { x: 0, y: 0, width: 320, height: 800 },
      insets: { top: 0, right: 0, bottom: 8, left: 0 },
    },
  });
  expect(footer).toHaveStyle({ paddingBottom: 16 });
  await fireEvent(safeArea, 'insetsChange', {
    nativeEvent: {
      frame: { x: 0, y: 0, width: 320, height: 800 },
      insets: { top: 0, right: 0, bottom: 40, left: 0 },
    },
  });
  expect(footer).toHaveStyle({ paddingBottom: 40 });

  await fireEvent(window, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 800 } },
  });
  expect(summary).toHaveStyle({ gap: 12 });
  expect(recipientCard).toHaveStyle({ padding: 14 });
  expect(scopeCard).toHaveStyle({ padding: 14 });
  expect(footer).toHaveStyle({ paddingHorizontal: 14, gap: 8 });
  expect(grabber).toHaveStyle({ marginTop: 6, marginBottom: 8 });

  await fireEvent(window, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 430, height: 500 } },
  });
  expect(footer).toHaveStyle({ paddingHorizontal: 14, gap: 8 });

  await fireEvent(window, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 430, height: 800 } },
  });
  expect(summary).toHaveStyle({ gap: 14 });
  expect(recipientCard).toHaveStyle({ padding: 18 });
  expect(scopeCard).toHaveStyle({ padding: 18 });
  expect(footer).toHaveStyle({ paddingHorizontal: 20, gap: 10 });
  expect(grabber).toHaveStyle({ marginTop: 8, marginBottom: 13 });
});

test('keeps the four transmission paragraphs individually readable in a compact sheet', async () => {
  const paragraphs = [
    t('modelSettings.consentConversationData'),
    t('modelSettings.consentJointWeb', { recipient: 'ChatGPT' }),
    t('modelSettings.consentJointCalendar', {
      recipient: 'OpenAI API',
      model: 'fixture·model',
    }),
    t('modelSettings.consentJointMedical'),
  ];
  const notice = t('modelSettings.consentContinuing');
  const subtitle = t('modelSettings.consentJointCalendarWebTitle');
  const decide = jest.fn();
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 320, height: 500 },
        insets: { top: 0, right: 0, bottom: 24, left: 0 },
      }}
    >
      <InferenceDisclosureSheet
        summary={{
          providerId: 'synthetic-provider',
          modelId: 'synthetic·model',
          recipient: 'ChatGPT',
          information: paragraphs.join('\n'),
          subtitle,
          notice,
        }}
        onDecision={decide}
      />
    </SafeAreaProvider>,
  );
  await fireEvent(screen.getByTestId('inference-disclosure-sheet'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 500 } },
  });
  const content = screen.getByTestId('inference-disclosure-content');
  const scope = within(content).getByTestId('inference-disclosure-scope');
  expect(scope).toHaveStyle({ gap: 12 });
  const blocks = within(scope).getAllByTestId('inference-disclosure-paragraph');
  expect(blocks).toHaveLength(4);
  paragraphs.forEach((copy, index) => {
    expect(blocks[index]).toHaveTextContent(copy, { exact: true });
    // Native Dynamic Type remains enabled, without a line or scaling cap.
    expect(blocks[index]?.props.allowFontScaling).not.toBe(false);
    expect(blocks[index]?.props.numberOfLines).toBeUndefined();
    expect(blocks[index]?.props.maxFontSizeMultiplier).toBeUndefined();
  });
  expect(blocks[0]).toHaveTextContent(/원본 사진은 전송하지 않습니다\./);
  expect(blocks[1]).toHaveTextContent(/ChatGPT의 공개 웹검색/);
  expect(blocks[2]).toHaveTextContent(/OpenAI API의 fixture·model/);
  expect(blocks[3]).toHaveTextContent(/Europe PMC/);
  expect(blocks[3]).toHaveTextContent(
    /건강 기록 원문이나 대화 전체를 검색 요청에 첨부하지 않습니다\./,
  );
  expect(
    [paragraphs[0], paragraphs[1], paragraphs[3], subtitle, notice].join(' '),
  ).not.toContain('·');
  expect(screen.getByText('synthetic·model')).toBeTruthy();
  expect(screen.getByText(notice)).toBeTruthy();
  expect(
    within(content).getByTestId('inference-disclosure-allow'),
  ).toBeEnabled();
  expect(
    within(content).getByTestId('inference-disclosure-cancel'),
  ).toBeEnabled();
  expect(decide).not.toHaveBeenCalled();
});

test('keeps the shared one-request scope and continuing notice in plain Korean', async () => {
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 430, height: 800 },
        insets: { top: 0, right: 0, bottom: 24, left: 0 },
      }}
    >
      <InferenceDisclosureSheet
        request={{
          ...disclosureRequest(),
          consentScope: {
            purpose: 'record_conversation',
            dataCategories: ['health_records', 'conversation'],
            policyVersion: 'synthetic',
          },
        }}
        onDecision={jest.fn()}
      />
    </SafeAreaProvider>,
  );
  const scope = screen.getByTestId('inference-disclosure-scope');
  expect(
    within(scope).getAllByTestId('inference-disclosure-paragraph'),
  ).toHaveLength(1);
  expect(scope).toHaveTextContent(
    '건강, 복약, 활동, 수면, 증상 기록, 질문과 대화',
  );
  expect(
    screen.getByText(
      '계정, AI, 기능, 정보 종류 또는 허용 범위가 바뀌면 다시 확인해요.',
    ),
  ).toBeTruthy();
});
