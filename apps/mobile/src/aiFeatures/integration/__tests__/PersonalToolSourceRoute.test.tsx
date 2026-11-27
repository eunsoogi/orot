import {
  expectSourceListenerRelease,
  sourceResult,
} from '../testSupport/expectSourceListenerRelease';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AiFeatureRoute } from '../AiFeatureRoute';
import { ConversationMessage as MockConversationMessage } from '../../../ragConversation/ConversationMessage';
import type { AiFeatureFlowScreenProps } from '../AiFeatureFlowScreenTypes';
import type { EvidenceSourceReadResult } from '../evidenceRegistry';
import { conversationToolEventFixtures as mockToolEvents } from '../../../ragConversation/testSupport/conversationToolEventFixtures';
import { preparePersonalSourceByResolver } from '../../../ragConversation/personalToolSourceRoute';
import { guardPersonalToolSource } from '../../../ragConversation/guardPersonalToolSource';
import type { ResolveConversationToolSource } from '../../../ragConversation/ConversationToolEventSources';
import type { ConversationSession } from '../../../ragConversation/conversationSessionTypes';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../featureServices', () => ({
  createAiFeatureServices: () => mockServices,
}));
jest.mock('../AiFeatureFlowScreen', () => ({
  AiFeatureFlowScreen: (props: AiFeatureFlowScreenProps) => {
    if (props.route !== 'saved-analysis')
      mockLeaveOrigin = props.onOpenSavedAnalysis;
    return (
      <MockConversationMessage
        message={{
          id: 9,
          role: 'assistant',
          content: '',
          toolMessageId: 'synthetic-turn',
          toolEvents: [mockToolEvents[0]!],
        }}
        resolveToolSource={mockLocalAdmission}
        toolSourceSessionId="synthetic-session"
        onOpenSource={props.onOpenSource}
        onLinkError={jest.fn()}
      />
    );
  },
}));

let mockLeaveOrigin: (() => void) | undefined;

const source = mockToolEvents[0]!.sources[0]!;
const reference: EvidenceReference = {
  ...source,
  reviewState: 'reviewed',
  effectiveTime: '2026-01-01',
  locator: {
    kind: 'local-evidence',
    token: 'e1',
    title: 'Synthetic private locator',
  },
};
const mockServices = {
  conversationSessionOptions: () => undefined,
  readSource: jest.fn<
    Promise<EvidenceSourceReadResult>,
    [EvidenceReference, AbortSignal]
  >(),
};
let mockLocalAdmission: ResolveConversationToolSource | undefined;
const originalAppState = AppState.currentState;
beforeEach(() => {
  jest.clearAllMocks();
  AppState.currentState = 'active';
});
afterEach(() => {
  AppState.currentState = originalAppState;
  mockLocalAdmission = undefined;
  jest.restoreAllMocks();
});

function held<T>() {
  let finish!: (value: T) => void;
  const promise = new Promise<T>(resolve => {
    finish = resolve;
  });
  return { promise, finish };
}

function admission(prepared = false) {
  const first = held<EvidenceReference>();
  const second = held<EvidenceSourceReadResult>();
  const admit = jest.fn((_source, _signal: AbortSignal) => first.promise);
  const session = {
    id: 1,
    pendingMessage: null,
    messages: [
      { toolMessageId: 'synthetic-turn', toolEvents: [mockToolEvents[0]!] },
    ],
  } as unknown as ConversationSession;
  if (prepared)
    preparePersonalSourceByResolver.set(admit, () => ({
      reference,
      read: signal => mockServices.readSource(reference, signal),
    }));
  let activeId = 1;
  const listeners = new Set<() => void>();
  mockLocalAdmission = guardPersonalToolSource(
    {
      getSnapshot: () => ({ sessions: [session], activeId, deleted: null }),
      ownsActiveSession: id => id === activeId,
      savedReportLease: () => ({ id: 'synthetic-session', version: 1 }),
      subscribe: listener => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    1,
    admit,
  );
  mockServices.readSource.mockImplementation(() => second.promise);
  return {
    admit,
    listeners,
    first,
    second,
    changeOwner(id: number) {
      activeId = id;
      listeners.forEach(listener => listener());
    },
  };
}

async function open() {
  const view = await render(<AiFeatureRoute onBack={jest.fn()} />);
  await fireEvent.press(
    screen.getByTestId('rag-tool-event-synthetic-run-tool-1-toggle'),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: /원문 출처 확인/u }),
  );
  expect(screen.getByTestId('ai-feature-source-loading')).toBeTruthy();
  expect(screen.getByTestId('ai-feature-source-heading')).toBeVisible();
  expect(mockServices.readSource).not.toHaveBeenCalled();
  await fireEvent(screen.getByTestId('ai-feature-source-detail'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 20 } },
  });
  return view;
}

async function admitDetail() {
  await fireEvent(
    screen.getByTestId('ai-feature-source-content-start'),
    'layout',
    {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 20 } },
    },
  );
  await waitFor(() => expect(mockServices.readSource).toHaveBeenCalledTimes(1));
}

test.each(['close', 'origin route replacement'])(
  'pending first proof is retired via %s with no late second read',
  async backTarget => {
    const { admit, first } = admission();
    await open();
    expect(admit).toHaveBeenCalledTimes(1);
    const signal = admit.mock.calls[0]![1];
    if (backTarget === 'close')
      await fireEvent.press(
        screen.getByTestId('conversation-personal-source-close'),
      );
    else await act(() => mockLeaveOrigin?.());
    expect(signal.aborted).toBe(true);
    await act(async () => first.finish(reference));
    expect(screen.queryByTestId('ai-feature-source-detail')).toBeNull();
    expect(mockServices.readSource).not.toHaveBeenCalled();
  },
);

test.each([false, true])(
  'current owner reaches one detail read (prepared: %s)',
  async prepared => {
    const { admit, first, second } = admission(prepared);
    await open();
    await act(async () => first.finish(reference));
    await admitDetail();
    expect(admit).toHaveBeenCalledTimes(prepared ? 0 : 1);
    expect(screen.queryByText('Synthetic private locator')).toBeNull();
    expect(screen.queryByText('Synthetic protected record')).toBeNull();
    await act(async () => second.finish(sourceResult));
    expect(screen.getByText('Synthetic protected record')).toBeTruthy();
  },
);

test.each([false, true])(
  'owner ABA during the detail read revokes the proof (prepared: %s)',
  async prepared => {
    const { first, second, changeOwner } = admission(prepared);
    await open();
    await act(async () => first.finish(reference));
    await admitDetail();
    const signal = mockServices.readSource.mock.calls[0]![1];
    await act(async () => {
      changeOwner(2);
      changeOwner(1);
      second.finish(sourceResult);
    });
    expect(signal.aborted).toBe(true);
    expect(screen.getByTestId('ai-feature-source-unavailable')).toBeTruthy();
    expect(screen.queryByText('Synthetic protected record')).toBeNull();
  },
);

test.each(['first', 'second'])(
  'provider teardown releases listeners while %s proof is held',
  async phase => {
    const checkListeners = expectSourceListenerRelease();
    const { admit, first, second, listeners } = admission();
    const view = await open();
    if (phase === 'second') {
      await act(async () => first.finish(reference));
      await admitDetail();
    }
    const firstSignal = admit.mock.calls[0]![1];
    const secondSignal = mockServices.readSource.mock.calls[0]?.[1];
    expect(listeners.size).toBe(1);
    await view.unmount();
    expect(firstSignal.aborted).toBe(true);
    if (secondSignal) expect(secondSignal.aborted).toBe(true);
    expect(listeners.size).toBe(0);
    checkListeners();
    await act(async () => {
      first.finish(reference);
      second.finish(sourceResult);
    });
    expect(mockServices.readSource).toHaveBeenCalledTimes(
      phase === 'first' ? 0 : 1,
    );
  },
);
