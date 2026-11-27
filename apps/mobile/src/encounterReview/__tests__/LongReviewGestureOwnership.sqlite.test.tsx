import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { providerSuccess } from '@orot/model-runtime';
import { useInferenceConsent } from '../../agent/execution/useInferenceConsent';
import { resolveSelectedAiProvider } from '../../aiFeatures/integration/provider';
import { consent } from '../__fixtures__/sqliteReview';
import {
  fixture,
  harness,
  recordingId,
} from '../__fixtures__/longReviewHarness';
import { EncounterReviewPanel } from '../EncounterReviewPanel';
import { EncounterReviewActions } from '../EncounterReviewActions';
import { reviewCopy } from '../strings';

jest.mock('../EncounterReviewActions', () => {
  const actual = jest.requireActual<typeof import('../EncounterReviewActions')>(
    '../EncounterReviewActions',
  );
  return { EncounterReviewActions: jest.fn(actual.EncounterReviewActions) };
});
jest.mock('../../agent/execution/useInferenceConsent', () => ({
  useInferenceConsent: jest.fn(),
}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

test('retired candidate callbacks cannot edit or approve the same ID in a replaced long review', async () => {
  const f = await harness(9);
  jest
    .mocked(useInferenceConsent)
    .mockReturnValue({ consent, disclosureSheet: null });
  const resolve = jest.mocked(resolveSelectedAiProvider);
  const selected = await resolve();
  if (selected.status !== 'ready')
    throw new Error('Missing selected fixture model');
  const segment = f.final;
  let firstCalls = 0;
  resolve.mockResolvedValueOnce({
    ...selected,
    provider: {
      ...selected.provider,
      async generate() {
        const terminal = ++firstCalls === 2;
        const evidence = [
          {
            segmentId: segment.id,
            startOffset: 0,
            endOffset: segment.text.length,
            quote: segment.text,
          },
        ];
        return providerSuccess({
          text: JSON.stringify({
            type: 'result',
            value: {
              candidates: terminal
                ? [
                    {
                      kind: 'plan',
                      text: 'First synthetic proposal',
                      speaker: 'unknown',
                      evidence,
                    },
                  ]
                : [],
            },
            citations: terminal ? [segment.id] : [],
          }),
          toolCalls: [],
          finishReason: 'complete',
        });
      },
    },
  });
  const ui = await render(
    <EncounterReviewPanel
      sourceId={recordingId}
      service={f.service}
      disabled={false}
      onInteractionChange={() => undefined}
    />,
  );
  try {
    const start = async () =>
      fireEvent.press(await screen.findByTestId('encounter-start'));
    const text = () => screen.getByTestId('encounter-text-candidate-0');
    const save = () => screen.getByTestId('encounter-save');
    await start();
    await screen.findByTestId('encounter-text-candidate-0');
    expect(text()).toHaveProp('value', 'First synthetic proposal');
    const queuedEdit = text().props.onChangeText as (value: string) => void;
    // The host Pressable uses responder events, so retain the mounted route's
    // real Save callback before it is replaced, not a synthetic onPress prop.
    const queuedSave = jest.mocked(EncounterReviewActions).mock.lastCall?.[0]
      .onSave;
    if (!queuedSave) throw new Error('Missing mounted Save action');
    await fireEvent.press(screen.getByTestId('encounter-deny'));
    await screen.findByText(reviewCopy.denied);
    await start();
    await screen.findByTestId('encounter-text-candidate-0');
    expect(text()).toHaveProp('value', segment.text);
    await act(() => queuedEdit('Late edit from retired review'));
    expect(text()).toHaveProp('value', segment.text);
    await act(() => queuedSave());
    expect(await fixture.rows()).toEqual([]);
    expect(save()).toBeTruthy();
    await fireEvent.press(save());
    await screen.findByText(reviewCopy.saved);
    expect(await fixture.rows()).toHaveLength(1);
    expect(firstCalls).toBe(2);
    expect(f.calls()).toBe(2);
  } finally {
    await ui.unmount();
    f.controller.dispose();
  }
});
