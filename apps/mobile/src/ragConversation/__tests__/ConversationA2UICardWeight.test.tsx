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
import { type GroundedRagAnswer, ragConversationTask } from '../task';
import { restoreConversationTask } from '../conversationTaskVersions';

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({
    width: 520,
    height: 844,
    scale: 3,
    fontScale: mockFontScale,
  }),
}));

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
  mockFontScale = 1;
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
  mockFontScale = 1.5;
  await ui.rerender(<ConversationA2UISurface root={root!} />);
  expect(grow()).toEqual([undefined, undefined]);
  mockFontScale = 1;
  await ui.rerender(<ConversationA2UISurface root={root!} />);
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

it('sizes two model-authored grouped columns proportionally only when readable', async () => {
  const prose = '요약\n핵심 한 줄\n세부 사항\n추가 설명';
  const input = {
    request: '요약과 세부 사항을 비교해서 보여 주세요.',
    context: [],
    evidence: { items: [], coverage: [], conflicts: [] },
  } as TaskResponderInput;
  const value = (weight: unknown = 2, parent = 'Row') => ({
    answerKind: 'conversation',
    answer: prose,
    a2uiFrames: [
      JSON.stringify({
        version: '1.0',
        createSurface: {
          surfaceId: 'orot:response:draft',
          catalogId: conversationA2UICatalog,
          components: [
            { id: 'root', component: parent, children: ['summary', 'details'] },
            {
              id: 'summary',
              component: 'Column',
              children: ['line0', 'line1'],
              weight: 1,
            },
            {
              id: 'details',
              component: 'Column',
              children: ['line2', 'line3'],
              weight,
            },
            ...prose.split('\n').map((text, index) => ({
              id: 'line' + index,
              component: 'Text',
              text,
            })),
          ],
        },
      }),
    ],
  });
  const result = ragConversationTask.validateResult(value(), input);
  if (result.status !== 'valid' || !result.value.a2uiPresentation)
    throw new Error('Expected the pinned weighted Column layout');
  const root = result.value.a2uiPresentation;
  mockFontScale = 1;
  const ui = await render(<ConversationA2UISurface root={root} />);
  const row = () => screen.getByTestId('conversation-a2ui-row');
  const width = (pixels: number) =>
    fireEvent(row(), 'layout', {
      nativeEvent: { layout: { width: pixels } },
    });
  const grow = () =>
    row().children.map(child =>
      typeof child === 'string'
        ? undefined
        : StyleSheet.flatten(child.props.style)?.flexGrow,
    );
  await width(580);
  expect(grow()).toEqual([1, 2]);
  await width(320);
  expect(grow()).toEqual([undefined, undefined]);
  await width(580);
  mockFontScale = 1.5;
  await ui.rerender(<ConversationA2UISurface root={root} />);
  expect(grow()).toEqual([undefined, undefined]);
  for (const line of prose.split('\n'))
    expect(screen.getByText(line)).toBeVisible();
  const archive = storeConversationA2UILayout(root, prose);
  const restored = restoreConversationA2UILayout(archive, prose)!;
  await ui.rerender(<ConversationA2UISurface root={restored} />);
  for (const line of prose.split('\n'))
    expect(screen.getByText(line)).toBeVisible();

  const fallback = {
    status: 'valid',
    value: { answerKind: 'conversation', answer: prose },
  };
  const old = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '52',
  });
  expect(old?.validateResult(value(), input)).toEqual(fallback);
  expect(ragConversationTask.validateResult(value(2, 'Column'), input)).toEqual(
    fallback,
  );
  expect(
    ragConversationTask.validateResult(value({ '@path': '/anything' }), input),
  ).toEqual(fallback);
});
