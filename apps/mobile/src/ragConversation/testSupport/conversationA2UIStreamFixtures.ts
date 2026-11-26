import { conversationA2UICatalog } from '../conversationA2UI';

const answer = '사과\n배';
export const previewOnly = '내부 검증 전 문자열';

function frame(operation: string, payload: object) {
  return JSON.stringify({
    version: '1.0',
    [operation]: { surfaceId: 'orot:response:draft', ...payload },
  });
}

const create = frame('createSurface', {
  catalogId: conversationA2UICatalog,
  components: [
    { id: 'root', component: 'Card', child: 'content' },
    { id: 'content', component: 'List', children: ['first', 'second'] },
    { id: 'first', component: 'Text', text: answer.split('\n')[0] },
    { id: 'second', component: 'Text', text: answer.split('\n')[1] },
  ],
});
const row = frame('updateComponents', {
  components: [
    { id: 'content', component: 'Row', children: ['first', 'second'] },
  ],
});
const replaceRoot = frame('updateComponents', {
  components: [{ id: 'root', component: 'Row', children: ['first', 'second'] }],
});
const repeated = frame('createSurface', {
  catalogId: conversationA2UICatalog,
  dataModel: { items: [{ title: previewOnly }, { title: '임시 값' }] },
  components: [
    { id: 'root', component: 'Card', child: 'content' },
    {
      id: 'content',
      component: 'Row',
      children: { path: '/items', componentId: 'item' },
    },
    { id: 'item', component: 'Text', text: { '@path': 'title' } },
  ],
});
const repeatedAnswer = '사과\n배\n자두';
const repeatedUpdate = frame('updateDataModel', {
  path: '/items',
  value: repeatedAnswer.split('\n').map(title => ({ title })),
});

export function streamedAnswer(
  mode: boolean | 'replacement' | 'object replacement',
) {
  const usesRepeatedChildren = mode === true;
  const update =
    mode === 'replacement' || mode === 'object replacement'
      ? replaceRoot
      : usesRepeatedChildren
        ? repeatedUpdate
        : row;
  const frames = [usesRepeatedChildren ? repeated : create, update];
  // Native Plan can produce the pinned JSON object representation directly.
  const wireFrames: unknown[] =
    mode === 'object replacement'
      ? frames.map(encoded => JSON.parse(encoded) as unknown)
      : frames;
  const envelope = JSON.stringify({
    type: 'result',
    value: {
      answerKind: 'conversation',
      answer: usesRepeatedChildren ? repeatedAnswer : answer,
      a2uiFrames: wireFrames,
    },
    citations: [],
  });
  const firstPart = envelope.slice(
    0,
    envelope.indexOf(JSON.stringify(wireFrames[1])),
  );
  return { envelope, firstPart, secondPart: envelope.slice(firstPart.length) };
}
