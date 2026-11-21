import { render, screen } from '@testing-library/react-native';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { projectTranscript } from '../conversationBubblePaint';
import type { DisplayMessage } from '../conversationDisplayMessage';
import type { StoredSteeringInstruction } from '../../storage/conversationSteeringStorage';
const opening = 'Synthetic reviewed opening';
const steering = 'Synthetic additional instruction';
const successor = 'Synthetic successor streaming';
function textOrder(tree: unknown): string {
  if (typeof tree === 'string') return tree;
  if (Array.isArray(tree)) return tree.map(textOrder).join('|');
  return tree && typeof tree === 'object' && 'children' in tree
    ? textOrder(tree.children)
    : '';
}
test.each([false, true])(
  'visible opening precedes queued steering while research is active (wide %s)',
  async wide => {
    const instruction: StoredSteeringInstruction = {
      id: 's',
      text: steering,
      sequence: 1,
      status: 'queued',
    };
    const message: DisplayMessage = {
      id: 2,
      role: 'assistant',
      streaming: true,
      content: '',
      initialResponse: { callId: 'first', text: opening },
    };
    const rows = (
      current: DisplayMessage,
      ...receipts: StoredSteeringInstruction[]
    ) => (
      <ConversationTranscriptMessages
        messages={projectTranscript(
          [{ id: 1, role: 'user', content: 'Synthetic question' }, current],
          wide,
        )}
        instructions={receipts}
        pendingId={2}
        showPendingBubble
        replyFocus={undefined}
        onLayout={() => {}}
        messageProps={{ onOpenSource: jest.fn(), onLinkError: jest.fn() }}
      />
    );
    const r = await render(rows(message, instruction));
    let order = textOrder(r.toJSON());
    expect(order.indexOf(opening)).toBeLessThan(order.indexOf(steering));
    expect(screen.getAllByTestId('conversation-steering-message')).toHaveLength(
      1,
    );
    await r.rerender(
      rows(
        { ...message, content: successor },
        { ...instruction, status: 'applied' },
      ),
    );
    order = textOrder(r.toJSON());
    expect(order.indexOf(opening)).toBeLessThan(order.indexOf(steering));
    expect(order.indexOf(steering)).toBeLessThan(order.indexOf(successor));
    expect(screen.getAllByTestId('conversation-steering-message')).toHaveLength(
      1,
    );
    const later = 'Synthetic later instruction';
    await r.rerender(
      rows(
        { ...message, content: successor },
        { ...instruction, status: 'applied' },
        { ...instruction, text: later, id: 's2', sequence: 2 },
      ),
    );
    order = textOrder(r.toJSON());
    expect(order.indexOf(steering)).toBeLessThan(order.indexOf(successor));
    expect(order.indexOf(successor)).toBeLessThan(order.indexOf(later));
    expect(screen.getAllByTestId('conversation-steering-message')).toHaveLength(
      2,
    );
  },
);
