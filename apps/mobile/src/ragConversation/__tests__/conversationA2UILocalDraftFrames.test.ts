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

test('only the coherent root owns the control pair', () => {
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

test('rejects invalid input and terminal frames', () => {
  const check = (frames: readonly string[], body = answer) =>
    expect(
      admitConversationA2UILocalDraftFrames(frames, body, validate),
    ).toBeUndefined();
  const after = (...items: readonly object[]) =>
    check([create, data, update(items)]);
  const otherLabel = { ...field, label: '개인정보를 적으세요' };
  const otherPath = { ...field, value: { '@path': '/unsafe' } };
  const otherAction = {
    ...button,
    action: { event: { name: 'send', context: { next: 'unsafe' } } },
  };
  const duplicateField = { ...root, children: [...root.children, 'field'] };
  after(root, otherLabel, button, label);
  after(root, otherPath, button, label);
  after(root, field, otherAction, label);
  after(duplicateField, field, button, label);
  after(root, { ...field, id: 'body' }, button, label);
  check([create, data, allowed, frame('deleteSurface', {})]);
  check([create, allowed, data]);
  check([create, data, allowed], '다른 응답');
});
