import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import { providerSuccess } from '@orot/model-runtime';
import { reviewCopy } from '../strings';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { startSavedRecordingAnalysis } from '../__fixtures__/startSavedRecordingAnalysis';
import { RecordingReviewRoute } from '../../routes/RecordingReviewRoute';
import { resolveSelectedAiProvider } from '../../aiFeatures/integration/provider';
import { harness, fixture } from '../__fixtures__/longReviewHarness';
// Native playback/transcript/export have their own integration suites; render the actual route and review controller here.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));
jest.mock('../../navigation/NavigationRouteScrollView', () => ({
  NavigationRouteScrollView: ({ children }: { children: ReactNode }) =>
    children,
}));
jest.mock('react-native-safe-area-context', () => {
  const ReactRuntime = require('react') as typeof import('react');
  return {
    SafeAreaInsetsContext: ReactRuntime.createContext({
      top: 0,
      left: 0,
      right: 0,
      bottom: 34,
    }),
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 34 }),
    SafeAreaProvider: ({ children }: { children?: ReactNode }) =>
      ReactRuntime.createElement(ReactRuntime.Fragment, null, children),
    SafeAreaView: ({ children }: { children?: ReactNode }) =>
      ReactRuntime.createElement(ReactRuntime.Fragment, null, children),
  };
});
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));
jest.mock('../../recording/RecordingSelectionContext', () => ({
  useRecordingSelection: () => ({
    selection: {
      summary: {
        source: {
          id: (
            require('../__fixtures__/longReviewHarness') as typeof import('../__fixtures__/longReviewHarness')
          ).recordingId,
        },
        durationMs: 3000,
      },
      autoPlay: false,
    },
  }),
}));
jest.mock('../../recording/useAutomaticRecordingTranscription', () => ({
  useAutomaticRecordingTranscription: () => ({}),
}));
jest.mock('../../recording/recordingService', () => ({ recordingService: {} }));
jest.mock('../../transcription/transcriptEvidenceService', () => ({
  transcriptEvidenceService: {},
}));
jest.mock('../../recording/RecordingPlaybackControls', () => () => null);
jest.mock('../../recording/RecordingExportPanel', () => () => null);
jest.mock('../../transcription/TranscriptEvidencePanel', () => () => null);
jest.mock('../../agent/execution/useInferenceConsent', () => ({
  useInferenceConsent: () => ({
    consent: { authorize: jest.fn(async () => 'authorized') },
    disclosureSheet: null,
  }),
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

test('retiring the recording route stops a held selected model lookup before extraction', async () => {
  const { calls, service } = await harness(9, 'local');
  const resolver = jest.mocked(resolveSelectedAiProvider);
  const resolve = resolver.getMockImplementation()!;
  let release!: () => void;
  let enter!: () => void;
  const entered = new Promise<void>(done => {
    enter = done;
  });
  resolver.mockImplementationOnce(async (...args) => {
    enter();
    await new Promise<void>(done => {
      release = done;
    });
    return resolve(...args);
  });
  let valid = true;
  const listeners = new Set<() => void>();
  const owner = {
    isCurrent: () => valid,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const view = await render(
    <RecordingReviewRoute reviewService={service} routeOwner={owner} />,
  );
  try {
    await startSavedRecordingAnalysis();
    await entered;
    await act(async () => {
      valid = false;
      listeners.forEach(listener => listener());
      release();
    });
    expect(calls()).toBe(0);
    expect(screen.queryByTestId('encounter-save')).toBeNull();
    expect(await fixture.rows()).toEqual([]);
  } finally {
    await view.unmount();
  }
});

test('a current recording route gets reviewable proposals from the selected fake model and saves only on tap', async () => {
  const { calls, service } = await harness(9, 'local');
  const view = await render(
    <RecordingReviewRoute
      reviewService={service}
      routeOwner={{ isCurrent: () => true, subscribe: () => () => {} }}
    />,
  );
  try {
    await startSavedRecordingAnalysis();
    await screen.findByTestId('encounter-save');
    expect(calls()).toBe(2);
    expect(await fixture.rows()).toEqual([]);
    await fireEvent.press(screen.getByTestId('encounter-save'));
    expect(await fixture.rows()).toHaveLength(1);
    expect(calls()).toBe(2);
  } finally {
    await view.unmount();
  }
});

test('foreground does not replay a held page and the same recording can restart by explicit tap', async () => {
  const { calls, service, listeners } = await harness(9, 'local');
  const resolver = jest.mocked(resolveSelectedAiProvider);
  const resolve = resolver.getMockImplementation()!;
  let count = 0;
  let release!: () => void;
  let enter!: () => void;
  const held = new Promise<void>(done => {
    enter = done;
  });
  const empty = () =>
    providerSuccess({
      text: '{"type":"result","value":{"candidates":[]},"citations":[]}',
      toolCalls: [],
      finishReason: 'complete' as const,
    });
  resolver.mockImplementationOnce(async (...args) => {
    const selected = await resolve(...args);
    if (selected.status !== 'ready') return selected;
    return {
      ...selected,
      provider: {
        ...selected.provider,
        async generate() {
          if (++count === 2) {
            enter();
            await new Promise<void>(done => {
              release = done;
            });
          }
          return empty();
        },
      },
    };
  });
  const view = await render(<RecordingReviewRoute reviewService={service} />);
  try {
    await screen.findByTestId('encounter-start');
    await fireEvent.press(screen.getByTestId('encounter-start'));
    await held;
    expect(
      await screen.findByTestId('encounter-batch-progress'),
    ).toHaveTextContent('전사 묶음 1개를 처리했어요.');

    expect(screen.getByTestId('encounter-status')).toHaveTextContent(
      reviewCopy.running,
    );
    await act(async () => {
      listeners.forEach(listener => listener({ kind: 'phase' }));
      release();
      listeners.forEach(listener => listener({ kind: 'phase' }));
    });
    await screen.findByText(reviewCopy.unavailable);
    expect(screen.queryByTestId('encounter-batch-progress')).toBeNull();
    expect(count).toBe(2);
    expect(calls()).toBe(0);
    expect(screen.queryByTestId('encounter-save')).toBeNull();
    expect(await fixture.rows()).toEqual([]);
    await fireEvent.press(screen.getByTestId('encounter-start'));
    await screen.findByTestId('encounter-save');
    expect(calls()).toBe(2);
    expect(screen.getByText('Synthetic ninth line only.')).toBeTruthy();
    expect(await fixture.rows()).toEqual([]);
  } finally {
    await view.unmount();
  }
});

test('a long saved recording distinguishes missing selection from unsupported transport and can start once selected', async () => {
  const { calls, service } = await harness(9, 'local');
  jest
    .mocked(providerSelectionStore.load)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({
      providerId: 'chatgpt-plan:synthetic:choice',
      modelId: 'synthetic-remote',
    });
  const view = await render(<RecordingReviewRoute reviewService={service} />);
  try {
    const start = async () =>
      fireEvent.press(await screen.findByTestId('encounter-start'));
    await start();
    await screen.findByText(reviewCopy['selection-required']);
    expect(screen.queryByTestId('encounter-save')).toBeNull();
    expect(calls()).toBe(0);
    expect(await fixture.rows()).toEqual([]);

    await start();
    await screen.findByText(reviewCopy['transcript-too-long']);
    expect(calls()).toBe(0);
    expect(await fixture.rows()).toEqual([]);

    await start();
    expect(await screen.findByTestId('encounter-save')).toBeTruthy();
    expect(calls()).toBe(2);
    expect(await fixture.rows()).toEqual([]);
  } finally {
    await view.unmount();
  }
});
