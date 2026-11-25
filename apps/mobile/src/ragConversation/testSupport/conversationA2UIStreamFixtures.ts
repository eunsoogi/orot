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

export function streamedAnswer(usesRepeatedChildren: boolean) {
  const update = usesRepeatedChildren ? repeatedUpdate : row;
  const envelope = JSON.stringify({
    type: 'result',
    value: {
      answerKind: 'conversation',
      answer: usesRepeatedChildren ? repeatedAnswer : answer,
      a2uiFrames: [usesRepeatedChildren ? repeated : create, update],
    },
    citations: [],
  });
  const firstPart = envelope.slice(0, envelope.indexOf(JSON.stringify(update)));
  return { envelope, firstPart, secondPart: envelope.slice(firstPart.length) };
}
