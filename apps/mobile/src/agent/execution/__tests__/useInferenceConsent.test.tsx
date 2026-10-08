import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Button } from 'react-native';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { useInferenceConsent } from '../useInferenceConsent';

function request(
  text: string,
  signal: AbortSignal = new AbortController().signal,
): OutboundProcessingRequest {
  return {
    operationRunId: 'synthetic-run',
    providerId: 'synthetic-provider',
    modelId: 'synthetic-model',
    recipient: 'synthetic-recipient',
    remoteProcessing: true,
    allowedScope: {
      sourceKinds: ['personal_record'],
      sourceIds: ['fixture-1'],
    },
    payload: { messages: [{ role: 'user', content: text }] },
    signal,
  };
}

function ConsentHarness({
  outboundRequest,
  onResult,
}: {
  readonly outboundRequest: OutboundProcessingRequest;
  readonly onResult?: (result: string) => void;
}) {
  const { consent, disclosureSheet } = useInferenceConsent();

  async function authorize() {
    const decision = await consent.authorize(outboundRequest);
    const nextResult = decision === 'authorized' ? 'authorized' : 'renewal';
    onResult?.(nextResult);
  }

  function startAuthorization(): void {
    // Keep the event handler synchronous so fireEvent can reach the pending consent decision.
    authorize().then(
      () => undefined,
      () => undefined,
    );
  }

  return (
    <>
      <Button
        onPress={startAuthorization}
        testID="authorize-request"
        title="Authorize request"
      />
      {disclosureSheet}
    </>
  );
}

describe('useInferenceConsent', () => {
  it('requires a fresh approval when the request payload changes', async () => {
    const original = request('Synthetic selected note A.');
    const onResult = jest.fn();
    const view = await render(
      <ConsentHarness outboundRequest={original} onResult={onResult} />,
    );

    await fireEvent.press(view.getByTestId('authorize-request'));
    expect(await view.findByText('Synthetic selected note A.')).toBeTruthy();
    await fireEvent.press(view.getByTestId('inference-disclosure-allow'));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('authorized'));

    await view.rerender(
      <ConsentHarness
        outboundRequest={request('Synthetic selected note B.')}
        onResult={onResult}
      />,
    );
    await fireEvent.press(view.getByTestId('authorize-request'));
    expect(await view.findByText('Synthetic selected note B.')).toBeTruthy();
    expect(onResult).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByTestId('inference-disclosure-allow'));
    await waitFor(() =>
      expect(onResult).toHaveBeenLastCalledWith('authorized'),
    );
  });

  it('denies an explicit user cancellation', async () => {
    const onResult = jest.fn();
    const view = await render(
      <ConsentHarness
        outboundRequest={request('Synthetic cancellation request.')}
        onResult={onResult}
      />,
    );

    await fireEvent.press(view.getByTestId('authorize-request'));
    expect(
      await view.findByText('Synthetic cancellation request.'),
    ).toBeTruthy();
    await fireEvent.press(view.getByTestId('inference-disclosure-cancel'));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('renewal'));
  });

  it('denies an open request on abort and when its screen unmounts', async () => {
    const controller = new AbortController();
    const onResult = jest.fn();
    const view = await render(
      <ConsentHarness
        outboundRequest={request('Synthetic request.', controller.signal)}
        onResult={onResult}
      />,
    );

    await fireEvent.press(view.getByTestId('authorize-request'));
    expect(await view.findByText('Synthetic request.')).toBeTruthy();
    await act(async () => controller.abort());
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('renewal'));
    expect(view.queryByTestId('inference-disclosure-sheet')).toBeNull();

    const unmountController = new AbortController();
    const onUnmountResult = jest.fn();
    await view.rerender(
      <ConsentHarness
        outboundRequest={request(
          'Synthetic second request.',
          unmountController.signal,
        )}
        onResult={onUnmountResult}
      />,
    );
    await fireEvent.press(view.getByTestId('authorize-request'));
    expect(await view.findByText('Synthetic second request.')).toBeTruthy();
    await act(async () => view.unmount());
    await waitFor(() =>
      expect(onUnmountResult).toHaveBeenCalledWith('renewal'),
    );
  });
});
