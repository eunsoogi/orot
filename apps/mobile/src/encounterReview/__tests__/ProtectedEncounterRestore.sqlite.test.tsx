import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { ConversationExecutionEvent } from '../../ragConversation/conversationExecutionLease';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { resolveSelectedAiProvider } from '../../aiFeatures/integration/provider';
import { openLocalStorage } from '../../storage/secureDatabase';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { EncounterReviewPanel } from '../EncounterReviewPanel';
import {
  consent,
  sourceId,
  sqliteReviewFixture,
} from '../__fixtures__/sqliteReview';
import { reviewCopy } from '../strings';

jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
jest.mock('../../agent/execution/useInferenceConsent', () => ({
  useInferenceConsent: () => ({
    consent: { authorize: jest.fn() },
    disclosureSheet: null,
  }),
}));

const fixture = sqliteReviewFixture();
const report = () => {};
const panel = (
  <EncounterReviewPanel
    sourceId={sourceId}
    disabled={false}
    onInteractionChange={report}
  />
);

test.each([
  'unknown',
  'held lock',
  'visible lock',
  'visible source removal',
] as const)(
  'only the protected mounted recording can display saved review candidates: %s',
  async mode => {
    const appState = AppState.currentState;
    AppState.currentState = 'active';
    const seed = fixture.controllerFor();
    const started = await seed.service.start(
      sourceId,
      consent,
      new AbortController().signal,
    );
    expect(started.status).toBe('pending');
    expect(seed.synthetic.calls()).toBe(1);
    expect(await fixture.rows()).toHaveLength(0);
    jest.mocked(openLocalStorage).mockClear();
    jest.mocked(resolveSelectedAiProvider).mockClear();
    const listeners = new Set<(event: ConversationExecutionEvent) => void>();
    let finish: ((allowed: boolean) => void) | undefined;
    let count = 0;
    let known = mode !== 'unknown';
    const native = jest.fn(async () => {
      if (++count === 2 && mode === 'held lock')
        return new Promise<boolean>(resolve => {
          finish = resolve;
        });
      return known ? true : null;
    });
    jest.mocked(conversationExecutionNative).mockReturnValue({
      bridgeAvailable: true,
      currentPhase: () => 'active',
      begin: async () => false,
      end() {},
      isActive: async () => false,
      protectedDataAvailable: native,
      subscribe(callback) {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      },
    });
    try {
      const view = await render(panel);
      try {
        if (mode === 'unknown') {
          await waitFor(() =>
            expect(screen.getByTestId('encounter-status')).toHaveTextContent(
              reviewCopy.unavailable,
            ),
          );
          expect(openLocalStorage).not.toHaveBeenCalled();
        } else if (mode === 'held lock') {
          await waitFor(() => expect(finish).toBeDefined());
          expect(screen.queryByTestId('encounter-candidate-0')).toBeNull();
          await act(async () => {
            for (const available of [false, true])
              [...listeners].forEach(callback =>
                callback({ kind: 'protectedData', available }),
              );
            finish?.(true);
          });
        } else {
          expect(
            await screen.findByTestId('encounter-candidate-0'),
          ).toBeTruthy();
          await act(async () => {
            if (mode === 'visible source removal')
              notifyLocalSourceDeleted('local', new Set([sourceId]));
            else
              [...listeners].forEach(callback =>
                callback({ kind: 'protectedData', available: false }),
              );
          });
        }
        expect(screen.queryByTestId('encounter-candidate-0')).toBeNull();
        expect(screen.queryByTestId('encounter-save')).toBeNull();
        expect(listeners.size).toBe(0);
        expect(resolveSelectedAiProvider).not.toHaveBeenCalled();
        expect(await fixture.rows()).toHaveLength(0);
      } finally {
        await view.unmount();
      }
      if (mode !== 'visible source removal') {
        known = true;
        const recovered = await render(panel);
        try {
          expect(
            await screen.findByTestId('encounter-candidate-0'),
          ).toBeTruthy();
          expect(await fixture.rows()).toHaveLength(0);
          expect(resolveSelectedAiProvider).not.toHaveBeenCalled();
        } finally {
          await recovered.unmount();
        }
      }
      expect(listeners.size).toBe(0);
    } finally {
      AppState.currentState = appState;
    }
  },
);
