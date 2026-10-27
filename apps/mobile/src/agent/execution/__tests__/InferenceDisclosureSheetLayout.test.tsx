import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import InferenceDisclosureSheet from '../InferenceDisclosureSheet';

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
  const footer = screen.getByTestId('inference-disclosure-footer');
  const content = screen.getByTestId('inference-disclosure-content');
  const grabber = screen.getByTestId('inference-disclosure-grabber', {
    includeHiddenElements: true,
  });

  expect(modal.props.presentationStyle).toBe('pageSheet');
  expect(content.props.stickyHeaderIndices).toEqual([1, 2]);
  expect(
    within(recipientCard).getByTestId('inference-disclosure-recipient'),
  ).toBeTruthy();
  expect(
    within(scopeCard).getByTestId('inference-disclosure-scope'),
  ).toBeTruthy();
  expect(within(footer).getAllByRole('button')).toHaveLength(2);
  expect(
    within(content).queryByTestId('inference-disclosure-footer'),
  ).toBeNull();

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
  expect(recipientCard).toHaveStyle({ padding: 18 });
  expect(scopeCard).toHaveStyle({ padding: 18 });
  expect(footer).toHaveStyle({ paddingHorizontal: 20, gap: 10 });
  expect(grabber).toHaveStyle({ marginTop: 8, marginBottom: 13 });
});
