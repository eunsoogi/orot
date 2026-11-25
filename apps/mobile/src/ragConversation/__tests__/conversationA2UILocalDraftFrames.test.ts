import { conversationA2UICatalog } from '../conversationA2UI';
import { acceptConversationA2UIFrameSequence } from '../conversationA2UIFrameSequence';
import {
  localA2UIDraftFieldLabel,
  localA2UIDraftPath,
  localA2UIDraftResetAction,
  localA2UIDraftResetLabel,
} from '../conversationA2UILocalDraft';
import {
  admitConversationA2UILocalDraftFrames,
  conversationA2UILocalDraftFor,
} from '../conversationA2UILocalDraftFrames';

const answer = '합성 조언';
const stamp = 'orot:response:draft';
const frame = (op: string, payload: object) =>
  JSON.stringify({ version: '1.0', [op]: { surfaceId: stamp, ...payload } });
const body = { id: 'body', component: 'Text', text: answer };
const create = frame('createSurface', {
  catalogId: conversationA2UICatalog,
  components: [{ id: 'root', component: 'Column', children: ['body'] }, body],
});
const data = frame('updateDataModel', { path: localA2UIDraftPath, value: '' });
const field = {
  id: 'field',
  component: 'TextField',
  label: localA2UIDraftFieldLabel,
  variant: 'shortText',
  value: { '@path': localA2UIDraftPath },
};
const button = {
  id: 'reset',
  component: 'Button',
  child: 'label',
  action: { event: { name: localA2UIDraftResetAction, context: {} } },
};
const label = { id: 'label', component: 'Text', text: localA2UIDraftResetLabel };
const root = {
  id: 'root',
  component: 'Column',
  children: ['body', field.id, button.id],
};
const update = (components: readonly object[]) =>
  frame('updateComponents', { components });
const validate = (frames: unknown, prose: string) =>
  acceptConversationA2UIFrameSequence(frames, prose, true);
const allowed = update([root, field, button, label]);

test('only the coherent root owns the final local pair; v22 and copies never do', () => {
  const frames = [create, data, allowed];
  expect(validate(frames, answer)).toBeUndefined();
  const result = admitConversationA2UILocalDraftFrames(frames, answer, validate)!;
  expect(result).toEqual({
    id: 'root',
    component: 'Column',
    children: [{ ...body, variant: 'body' }],
  });
  expect(conversationA2UILocalDraftFor(result)).toEqual({
    fieldId: 'field',
    resetId: 'reset',
  });
  expect(conversationA2UILocalDraftFor({ ...result })).toBeUndefined();
});

test('rejects arbitrary bindings, provider context, earlier ids and bad terminal order', () => {
  const variants = [
    [create, data, update([root, { ...field, label: '개인정보를 적으세요' }, button, label])],
    [create, data, update([root, { ...field, value: { '@path': '/unsafe' } }, button, label])],
    [create, data, update([root, field, { ...button, action: { event: { name: 'send', context: { next: 'unsafe' } } } }, label])],
    [create, data, update([{ ...root, children: [...root.children, 'field'] }, field, button, label])],
    [create, data, update([root, { ...field, id: 'body' }, button, label])],
    [create, data, allowed, frame('deleteSurface', {})],
    [create, allowed, data],
  ];
  for (const frames of variants)
    expect(admitConversationA2UILocalDraftFrames(frames, answer, validate)).toBeUndefined();
  expect(admitConversationA2UILocalDraftFrames([create, data, allowed], '다른 응답', validate)).toBeUndefined();
});
