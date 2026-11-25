import type {
  TaskResponderContract,
  TaskResponderInput,
} from '@orot/agent-runtime';
import { render, screen } from '@testing-library/react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { a2uiSurfaceStyles } from '../conversationA2UISurfaceStyles';
import { conversationA2UICatalog } from '../conversationA2UI';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from '../conversationA2UIArchive';
import { withConversationA2UIFrameSequence } from '../conversationA2UIFrameSequence';
import { withConversationA2UIModal } from '../conversationA2UIModalTask';
import { withFinalConversationCaption } from '../conversationA2UICaptionTask';
import type { GroundedRagAnswer } from '../task';

const answer = '본문\n보조 문구';
const frame = (style: unknown = 'caption', caption = '보조 문구') =>
  JSON.stringify({
    version: '1.0',
    createSurface: {
      surfaceId: 'orot:response:draft',
      catalogId: conversationA2UICatalog,
      components: [
        { id: 'root', component: 'Column', children: ['body', 'caption'] },
        { id: 'body', component: 'Text', text: '본문' },
        { id: 'caption', component: 'Text', text: caption, variant: style },
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
const oldTask = withConversationA2UIModal(
  withConversationA2UIFrameSequence(base, () => true, '31'),
);
const task = withFinalConversationCaption(oldTask);
function layout(raw: string[], responder = task) {
  const result = responder.validateResult({ answer, a2uiFrames: raw }, {
    request: 'Synthetic caption request',
  } as TaskResponderInput);
  return result.status === 'valid' ? result.value.a2uiPresentation : undefined;
}

it('renders the exact literal caption with scaling and restores the same text as body', async () => {
  const root = layout([frame()]);
  expect(root).toBeDefined();
  expect(layout([frame()], oldTask)).toBeUndefined();
  const ui = await render(<ConversationA2UISurface root={root!} />);
  expect(screen.getByText('본문')).toHaveStyle(a2uiSurfaceStyles.body);
  expect(screen.getByText('보조 문구')).toHaveStyle(a2uiSurfaceStyles.caption);
  expect(screen.getByText('보조 문구')).toHaveProp('allowFontScaling', true);
  const archive = storeConversationA2UILayout(root!, answer);
  const restored = restoreConversationA2UILayout(archive, answer)!;
  await ui.rerender(<ConversationA2UISurface root={restored} />);
  expect(screen.getByText('보조 문구')).toHaveStyle(a2uiSurfaceStyles.body);
});

it('cannot add new prose, an unpinned heading, dynamic variant, or streamed caption', () => {
  expect(layout([frame('caption', 'changed')])).toBeUndefined();
  expect(layout([frame('heading')])).toBeUndefined();
  expect(layout([frame({ '@path': '/style' })])).toBeUndefined();
  expect(layout([frame(), frame()])).toBeUndefined();
});
