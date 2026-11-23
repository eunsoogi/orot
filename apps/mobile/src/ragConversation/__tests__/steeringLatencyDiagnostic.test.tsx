import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { ConversationSteeringMessages } from '../ConversationSteeringMessages';
import { createConversationSteeringOwner } from '../conversationSteeringOwner';
import type { ConversationSession } from '../conversationSessionTypes';
import type { StoredSteeringInstruction } from '../../storage/conversationSteeringStorage';

jest.mock('../ConversationBubbleEntrance', () => ({
  ConversationBubbleEntrance: require('react-native').View,
}));

test.each([false, true])(
  'separates held enqueue, row layout and confirmed Read with owner finished: %s',
  async finished => {
    const before = NativeModules.OrotProviderDiagnostics;
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { enabled: true, report };
    const clock = jest.spyOn(performance, 'now');
    let ms = 0;
    clock.mockImplementation(() => ms);
    let session = {
      id: 1,
      draft: 'Synthetic private words',
      messages: [],
    } as unknown as ConversationSession;
    let rows: StoredSteeringInstruction[] = [];
    let refresh!: () => Promise<void>;
    let enqueueDone!: () => void;
    let current = true;
    const isCurrent = () => current;
    let id!: string;
    const owner = createConversationSteeringOwner(
      () => session,
      (_id, change) => {
        session = { ...session, ...change };
      },
    );
    const stages = () => report.mock.calls.map(args => args[1]);
    const stamp = '2090-04-23T12:00:00.000Z';
    const flush = () => Promise.resolve();
    let offer!: Promise<void>;
    try {
      owner.bind(
        1,
        {
          list: async () => rows,
          subscribe(fn: () => Promise<void>) {
            refresh = fn;
            return () => {};
          },
          async enqueue(next: string) {
            id = next;
            return new Promise<boolean>(resolve => {
              enqueueDone = () => resolve(true);
            });
          },
        } as unknown as Parameters<typeof owner.bind>[1],
        isCurrent,
      );
      await flush();
      offer = owner.submit(1);
      expect(stages()).toEqual(['steering_submit_admitted']);
      const view = await render(
        <ConversationSteeringMessages
          instructions={session.steeringInstructions}
        />,
      );
      expect(screen.queryByTestId('conversation-steering-message')).toBeNull();

      ms = 500;
      rows = [
        {
          id,
          sequence: 1,
          text: session.draft,
          status: 'queued',
          submittedAt: stamp,
        },
      ];
      await refresh();
      ms = 530;
      enqueueDone();
      await offer;

      ms = 600;
      await view.rerender(
        <ConversationSteeringMessages
          instructions={session.steeringInstructions}
        />,
      );
      const row = screen.getByTestId('conversation-steering-message');
      expect(screen.queryByText(/전송 중|읽음/)).toBeNull();
      await fireEvent(row, 'layout', {
        nativeEvent: { layout: { width: 200, height: 60 } },
      });
      expect(stages()).toEqual([
        'steering_submit_admitted',
        'steering_row_available',
        'steering_enqueue_resolved',
        'steering_row_layout',
      ]);

      ms = 2_400;
      rows = [{ ...rows[0]!, status: 'applied', readAt: stamp }];
      await refresh();
      expect(stages().at(-1)).toBe('steering_applied_observed');
      if (finished) {
        owner.finish(1, isCurrent);
        current = false;
      }
      ms = 2_460;
      await view.rerender(
        <ConversationSteeringMessages
          instructions={session.steeringInstructions}
        />,
      );
      const receipt = screen.getByText(/읽음/);
      await fireEvent(receipt, 'textLayout', {
        nativeEvent: { lines: [{ text: 'timestamp only' }] },
      });
      expect(stages()).not.toContain('steering_read_layout');
      const rendered = Array.isArray(receipt.props.children)
        ? receipt.props.children.join('')
        : String(receipt.props.children);
      await act(async () => {
        await fireEvent(receipt, 'textLayout', {
          nativeEvent: { lines: [{ text: rendered }] },
        });
        await fireEvent(receipt, 'textLayout', {
          nativeEvent: { lines: [{ text: rendered }] },
        });
      });
      expect(report.mock.calls).toEqual([
        ['rag', 'steering_submit_admitted', '0'],
        ['rag', 'steering_row_available', '500'],
        ['rag', 'steering_enqueue_resolved', '530'],
        ['rag', 'steering_row_layout', '600'],
        ['rag', 'steering_applied_observed', '2400'],
        ...(finished ? [] : [['rag', 'steering_read_layout', '2460']]),
      ]);
      current = false;
      owner.clear(1);
      await view.unmount();
    } finally {
      owner.dispose();
      clock.mockRestore();
      NativeModules.OrotProviderDiagnostics = before;
    }
  },
);

test('normal execution does not emit opt-in timing', async () => {
  const before = NativeModules.OrotProviderDiagnostics;
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { enabled: false, report };
  let session = {
    id: 1,
    draft: 'Synthetic',
    messages: [],
  } as unknown as ConversationSession;
  const owner = createConversationSteeringOwner(
    () => session,
    (_id, change) => {
      session = { ...session, ...change };
    },
  );
  const store = {
    list: async () => [],
    async enqueue() {
      return true;
    },
  } as unknown as Parameters<typeof owner.bind>[1];
  try {
    owner.bind(1, store, () => true);
    await owner.submit(1);
    expect(report).not.toHaveBeenCalled();
  } finally {
    owner.dispose();
    NativeModules.OrotProviderDiagnostics = before;
  }
});
