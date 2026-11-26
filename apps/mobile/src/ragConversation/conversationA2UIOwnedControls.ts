import { exactlyLocalControl } from './conversationA2UIFinalLocalControl';
import {
  localA2UICheckLabel,
  localA2UICheckPath,
  localA2UIChoiceLabel,
  localA2UIChoicePath,
  localA2UIChoices,
} from './conversationA2UILocalDraft';
import { isObject } from './taskHistory';

export function checkboxControl(control: Record<string, unknown>) {
  return (
    exactlyLocalControl(control, ['id', 'component', 'label', 'value']) &&
    control.component === 'CheckBox' &&
    control.label === localA2UICheckLabel &&
    isObject(control.value) &&
    exactlyLocalControl(control.value, ['@path']) &&
    control.value['@path'] === localA2UICheckPath
  );
}

export function choiceControl(node: Record<string, unknown>) {
  return (
    exactlyLocalControl(node, [
      'id',
      'component',
      'label',
      'variant',
      'options',
      'value',
    ]) &&
    node.component === 'ChoicePicker' &&
    node.label === localA2UIChoiceLabel &&
    node.variant === 'mutuallyExclusive' &&
    Array.isArray(node.options) &&
    node.options.length === localA2UIChoices.length &&
    localA2UIChoices.every((option, index) => {
      const proposed: unknown = (node.options as unknown[])[index];
      return (
        isObject(proposed) &&
        exactlyLocalControl(proposed, ['label', 'value']) &&
        proposed.label === option.label &&
        proposed.value === option.value
      );
    }) &&
    isObject(node.value) &&
    exactlyLocalControl(node.value, ['@path']) &&
    node.value['@path'] === localA2UIChoicePath
  );
}
