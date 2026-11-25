import type {
  TaskResponderContract,
  TaskResponderInput,
} from '@orot/agent-runtime';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { conversationA2UICatalog } from '../conversationA2UI';
import { ConversationA2UILocalDraftOwner } from '../conversationA2UILocalDraftOwner';
import { withConversationA2UIFrameSequence } from '../conversationA2UIFrameSequence';
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

const answer = '세부 사항 열기\n검증된 내용';
const frame = (modal: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: '1.0',
    createSurface: {
      surfaceId: 'orot:response:draft',
      catalogId: conversationA2UICatalog,
      components: [
        {
          id: 'root',
          component: 'Modal',
          trigger: 'trigger',
          content: 'panel',
          ...modal,
        },
        { id: 'trigger', component: 'Text', text: '세부 사항 열기' },
        { id: 'panel', component: 'Text', text: '검증된 내용' },
      ],
    },
  });

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
const task = withConversationA2UIModal(oldTask);

function select(raw: string[], responder = task) {
  const result = responder.validateResult({ answer, a2uiFrames: raw }, {
    request: 'Synthetic request',
  } as TaskResponderInput);
  return result.status === 'valid' ? result.value.a2uiPresentation : undefined;
}

it('admits only the v32 final static trigger/content shape', () => {
  expect(select([frame()])).toBeDefined();
  expect(select([frame()], oldTask)).toBeUndefined();
  for (const bad of [
    { nativeAction: 'forged' },
    { trigger: 'root' },
    { content: 'trigger' },
    { content: 'missing' },
    { trigger: { '@path': '/dynamic' } },
  ])
    expect(select([frame(bad)])).toBeUndefined();
  expect(select([frame(), frame()])).toBeUndefined();
});

it('opens only from an exact live tap, closes on retirement, and restores inline', async () => {
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
  expect(screen.queryByText('검증된 내용')).toBeNull();
  await fireEvent.press(screen.getByTestId('conversation-a2ui-open-modal'));
  expect(await screen.findByText('검증된 내용')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('conversation-a2ui-close-modal'));
  expect(screen.queryByText('검증된 내용')).toBeNull();

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
  // RNTL awaits the onPress promise. Release the native test gate before
  // awaiting that dispatch, but only after the actual check is in flight.
  await act(async () => {
    const press = fireEvent.press(
      screen.getByTestId('conversation-a2ui-open-modal'),
    );
    await checking;
    current = false;
    listeners.forEach(listener => listener());
    current = true;
    listeners.forEach(listener => listener());
    complete(true);
    await press;
  });
  expect(screen.queryByTestId('conversation-a2ui-close-modal')).toBeNull();
  await fireEvent.press(screen.getByTestId('conversation-a2ui-open-modal'));
  expect(await screen.findByText('검증된 내용')).toBeTruthy();
  await act(() => {
    [...nativeListeners].forEach(listener =>
      listener({ kind: 'protectedData', available: false }),
    );
  });
  expect(screen.queryByTestId('conversation-a2ui-close-modal')).toBeNull();

  const archive = storeConversationA2UILayout(root, answer);
  const restored = restoreConversationA2UILayout(archive, answer)!;
  await ui.rerender(tree(restored));
  expect(screen.getByText('검증된 내용')).toBeTruthy();
  expect(screen.queryByTestId('conversation-a2ui-open-modal')).toBeNull();
  await ui.unmount();
  expect(nativeListeners.size).toBe(0);
});
