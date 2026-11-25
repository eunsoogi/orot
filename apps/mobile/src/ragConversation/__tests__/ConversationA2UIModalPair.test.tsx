import type {
  TaskResponderContract,
  TaskResponderInput,
} from '@orot/agent-runtime';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { conversationA2UICatalog } from '../conversationA2UI';
import { ConversationA2UILocalDraftOwner } from '../conversationA2UILocalDraftOwner';
import { withConversationA2UIFrameSequence } from '../conversationA2UIFrameSequence';
import { withConversationA2UIModalPair } from '../conversationA2UIModalPairTask';
import { withConversationA2UIModal } from '../conversationA2UIModalTask';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from '../conversationA2UIArchive';
import { conversationExecutionNative } from '../conversationExecutionNative';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import type { GroundedRagAnswer } from '../task';

jest.mock('../conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

const summary = '두 가지 관점으로 보여드릴게요.';
const evidence = '첫 번째 비교 예시';
const method = '두 번째 비교 예시';
const answer = [summary, '근거 보기', evidence, '비교 방법 보기', method].join(
  '\n',
);
function frame(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: '1.0',
    createSurface: {
      surfaceId: 'orot:response:draft',
      catalogId: conversationA2UICatalog,
      components: [
        {
          id: 'root',
          component: 'Column',
          children: ['summary', 'evidence-sheet', 'method-sheet'],
        },
        { id: 'summary', component: 'Text', text: summary },
        {
          id: 'evidence-sheet',
          component: 'Modal',
          trigger: 'show-evidence',
          content: 'evidence',
          ...overrides,
        },
        { id: 'show-evidence', component: 'Text', text: '근거 보기' },
        { id: 'evidence', component: 'Text', text: evidence },
        {
          id: 'method-sheet',
          component: 'Modal',
          trigger: 'show-method',
          content: 'method',
        },
        { id: 'show-method', component: 'Text', text: '비교 방법 보기' },
        { id: 'method', component: 'Text', text: method },
      ],
    },
  });
}

const base = {
  createResultSchema: () => ({
    properties: { answer: {} },
    required: ['answer'],
  }),
  validateResult: (raw: Record<string, unknown>) => ({
    status: 'valid',
    value: { answerKind: 'conversation', ...raw },
  }),
} as unknown as TaskResponderContract<GroundedRagAnswer>;
const oldTask = withConversationA2UIFrameSequence(base, () => true, '31');
const previous = withConversationA2UIModal(oldTask);
const task = withConversationA2UIModalPair(previous);

function select(raw: string[], responder = task) {
  const result = responder.validateResult({ answer, a2uiFrames: raw }, {
    request: 'Synthetic request',
  } as TaskResponderInput);
  return result.status === 'valid' ? result.value.a2uiPresentation : undefined;
}

it('requires distinct owned panels and exact accepted prose with no local or external actions', () => {
  expect(select([frame()])).toBeDefined();
  expect(select([frame()], previous)).toBeUndefined();
  for (const bad of [
    { content: 'method' },
    { trigger: 'show-method' },
    { content: 'method-sheet' },
    { content: 'summary' },
    { action: { name: 'openUrl' } },
  ])
    expect(select([frame(bad)])).toBeUndefined();
  expect(select([frame().replace(evidence, '추가 문장')])).toBeUndefined();
  expect(select([frame(), frame()])).toBeUndefined();
});

it('admits only one pending or open sheet and retires late contenders', async () => {
  const root = select([frame()])!;
  const listeners = new Set<() => void>();
  const nativeListeners = new Set<
    (event: ConversationExecutionEvent) => void
  >();
  let current = true;
  const owner = {
    surface: (node: typeof root) =>
      current && node === root ? 'orot:1:2' : undefined,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const protectedDataAvailable = jest.fn(async (): Promise<boolean> => true);
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    begin: async () => false,
    end: () => {},
    isActive: async () => false,
    protectedDataAvailable,
    subscribe(listener) {
      nativeListeners.add(listener);
      return () => {
        nativeListeners.delete(listener);
      };
    },
  });
  const tree = (node: typeof root) => (
    <ConversationA2UILocalDraftOwner.Provider value={owner}>
      <ConversationA2UISurface root={node} />
    </ConversationA2UILocalDraftOwner.Provider>
  );

  const ui = await render(tree(root));
  const open = (position: number) =>
    fireEvent.press(
      screen.getAllByTestId('conversation-a2ui-open-modal', {
        includeHiddenElements: true,
      })[position]!,
    );
  const close = () =>
    fireEvent.press(screen.getByTestId('conversation-a2ui-close-modal'));
  expect(screen.getByText(summary)).toBeTruthy();
  expect(screen.queryByText(evidence)).toBeNull();
  expect(screen.queryByText(method)).toBeNull();

  let complete!: (available: boolean) => void;
  let entered!: () => void;
  const checking = new Promise<void>(resolve => {
    entered = resolve;
  });
  protectedDataAvailable.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        complete = resolve;
        entered();
      }),
  );
  await act(async () => {
    const pending = open(0);
    await checking;
    await open(1);
    expect(protectedDataAvailable).toHaveBeenCalledTimes(1);
    current = false;
    [...listeners].forEach(listener => listener());
    current = true;
    [...listeners].forEach(listener => listener());
    complete(true);
    await pending;
  });
  expect(screen.queryByTestId('conversation-a2ui-close-modal')).toBeNull();
  await open(1);
  expect(screen.getByText(method)).toBeTruthy();
  await open(0);
  expect(screen.queryByText(evidence)).toBeNull();
  expect(screen.getAllByTestId('conversation-a2ui-close-modal')).toHaveLength(
    1,
  );
  await close();
  await open(0);
  expect(screen.getByText(evidence)).toBeTruthy();
  expect(screen.queryByText(method)).toBeNull();
  await act(() => {
    [...nativeListeners].forEach(listener =>
      listener({ kind: 'protectedData', available: false }),
    );
  });
  expect(screen.queryByTestId('conversation-a2ui-close-modal')).toBeNull();

  const archive = storeConversationA2UILayout(root, answer);
  const restored = restoreConversationA2UILayout(archive, answer)!;
  await ui.rerender(tree(restored));
  expect(screen.getByText(evidence)).toBeTruthy();
  expect(screen.getByText(method)).toBeTruthy();
  expect(screen.queryByTestId('conversation-a2ui-open-modal')).toBeNull();
  await ui.unmount();
  expect(nativeListeners.size).toBe(0);
});
