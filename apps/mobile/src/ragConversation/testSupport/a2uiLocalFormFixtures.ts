import { conversationA2UICatalog } from '../conversationA2UI';
import {
  localA2UICheckLabel,
  localA2UICheckPath,
  localA2UIChoiceLabel,
  localA2UIChoicePath,
  localA2UIChoices,
} from '../conversationA2UILocalDraft';

export const parts = ['합성 답변 첫 부분', '합성 답변 두 번째 부분'];
export const answer = parts.join('\n');
export function frame(
  op: string,
  payload: object,
  surfaceId = 'orot:response:draft',
) {
  return JSON.stringify({ version: '1.0', [op]: { surfaceId, ...payload } });
}
export const base = frame('createSurface', {
  catalogId: conversationA2UICatalog,
  components: [
    { id: 'root', component: 'Column', children: ['a', 'b'] },
    { id: 'a', component: 'Text', text: parts[0] },
    { id: 'b', component: 'Text', text: parts[1] },
  ],
});
const check = {
  id: 'confirm',
  component: 'CheckBox',
  label: localA2UICheckLabel,
  value: { '@path': localA2UICheckPath },
};
export const choice = {
  id: 'choose',
  component: 'ChoicePicker',
  label: localA2UIChoiceLabel,
  variant: 'mutuallyExclusive',
  options: localA2UIChoices,
  value: { '@path': localA2UIChoicePath },
};
export const seedCheck = frame('updateDataModel', {
  path: localA2UICheckPath,
  value: false,
});
export const seedChoice = frame('updateDataModel', {
  path: localA2UIChoicePath,
  value: [],
});
export const final = (picker: object = choice) =>
  frame('updateComponents', {
    components: [
      {
        id: 'root',
        component: 'Column',
        children: ['a', 'b', 'confirm', 'choose'],
      },
      check,
      picker,
    ],
  });
