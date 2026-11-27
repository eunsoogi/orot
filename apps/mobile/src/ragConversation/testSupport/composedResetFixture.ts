import { conversationA2UICatalog } from '../conversationA2UI';
import { localA2UIDraftResetAction } from '../conversationA2UILocalDraft';
import { frame } from './a2uiLocalFormFixtures';

export const resetLabel = 'Clear form choices';
export function resetProposal(
  existing: { answer: string; a2uiFrames: string[]; answerKind: string },
  context: object = {},
  label = resetLabel,
) {
  const read = (index: number) => JSON.parse(existing.a2uiFrames[index]!);
  const elements = read(0).createSurface.components.slice(1);
  const [root, ...controls] = read(3).updateComponents.components;
  const button = {
    id: 'reset',
    component: 'Button',
    child: 'reset-label',
    action: { event: { name: localA2UIDraftResetAction, context } },
  };
  return {
    ...existing,
    answer: existing.answer + '\n\n' + label,
    a2uiFrames: [
      frame('createSurface', {
        catalogId: conversationA2UICatalog,
        components: [
          { ...root, children: [...root.children, button.id] },
          ...elements,
          ...controls,
          button,
          { id: button.child, component: 'Text', text: label },
        ],
      }),
    ],
  };
}
