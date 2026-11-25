import type {
  TaskResponderContract,
  TaskResponderInput,
} from '@orot/agent-runtime';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { conversationA2UICatalog } from '../conversationA2UI';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from '../conversationA2UIArchive';
import { withFinalConversationCardWeight } from '../conversationA2UICardWeightTask';
import { withFinalConversationCaption } from '../conversationA2UICaptionTask';
import { withConversationA2UIFrameSequence } from '../conversationA2UIFrameSequence';
import { withConversationA2UIModal } from '../conversationA2UIModalTask';
import type { GroundedRagAnswer } from '../task';

const answer = '첫 번째\n두 번째';
function frame(weight: unknown = 2, parent = 'Row', secondCard = false) {
  return JSON.stringify({
    version: '1.0',
    createSurface: {
      surfaceId: 'orot:response:draft',
      catalogId: conversationA2UICatalog,
      components: [
        { id: 'root', component: parent, children: ['card', 'second'] },
        { id: 'card', component: 'Card', child: 'first', weight },
        { id: 'first', component: 'Text', text: '첫 번째' },
        ...(secondCard
          ? [
              {
                id: 'second',
                component: 'Card',
                child: 'second-text',
                weight: 1,
              },
              { id: 'second-text', component: 'Text', text: '두 번째' },
            ]
          : [{ id: 'second', component: 'Text', text: '두 번째' }]),
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
const legacy = withFinalConversationCaption(
  withConversationA2UIModal(
    withConversationA2UIFrameSequence(base, () => true, '31'),
  ),
);
const task = withFinalConversationCardWeight(legacy);
function layout(raw: string[], responder = task) {
  const result = responder.validateResult({ answer, a2uiFrames: raw }, {
    request: 'Synthetic request',
  } as TaskResponderInput);
  return result.status === 'valid' ? result.value.a2uiPresentation : undefined;
}

it('keeps direct Card proportions only at comfortable width and older archive readable', async () => {
  const root = layout([frame()]);
  expect(root).toBeDefined();
  expect(layout([frame()], legacy)).toBeUndefined();
  const ui = await render(<ConversationA2UISurface root={root!} />);
  const row = () => screen.getByTestId('conversation-a2ui-row');
  const width = (value: number) =>
    fireEvent(row(), 'layout', { nativeEvent: { layout: { width: value } } });
  const grow = () =>
    row().children.map(child =>
      typeof child === 'string'
        ? undefined
        : StyleSheet.flatten(child.props.style)?.flexGrow,
    );
  expect(grow()).toEqual([undefined, undefined]);
  await width(371);
  expect(grow()).toEqual([undefined, undefined]);
  await width(372);
  expect(grow()).toEqual([2, 1]);

  const twoCards = layout([frame(2, 'Row', true)])!;
  await ui.rerender(<ConversationA2UISurface root={twoCards} />);
  await width(443);
  expect(grow()).toEqual([undefined, undefined]);
  expect(screen.getByText('두 번째')).toBeTruthy();
  await width(444);
  expect(grow()).toEqual([2, 1]);
  await ui.rerender(<ConversationA2UISurface root={root!} />);
  await width(280);
  expect(grow()).toEqual([undefined, undefined]);
  expect(screen.getByText('첫 번째')).toBeTruthy();
  expect(screen.getByText('두 번째')).toBeTruthy();
  const archive = storeConversationA2UILayout(root!, answer);
  const restored = restoreConversationA2UILayout(archive, answer)!;
  await ui.rerender(<ConversationA2UISurface root={restored} />);
  await width(460);
  expect(grow()).toEqual([undefined, undefined]);
  expect(screen.getByText('첫 번째')).toBeTruthy();
  expect(screen.getByText('두 번째')).toBeTruthy();
});

it('rejects invalid values, non-Row placement and incremental attempts', () => {
  for (const denied of [0, 4, '2', null, { '@path': '/width' }])
    expect(layout([frame(denied)])).toBeUndefined();
  expect(layout([frame(2, 'Column')])).toBeUndefined();
  expect(layout([frame(), frame()])).toBeUndefined();
});
