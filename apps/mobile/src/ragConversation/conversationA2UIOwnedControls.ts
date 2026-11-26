import { exactlyLocalControl } from './conversationA2UIFinalLocalControl';
import {
  localA2UICheckLabel,
  localA2UICheckPath,
  localA2UIChoiceLabel,
  localA2UIChoicePath,
  localA2UIChoices,
} from './conversationA2UILocalDraft';
import { isObject } from './taskHistory';

function plainLocalLabel(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 40 &&
    value.trim() === value &&
    !/[<>\[\]#*`_~\\]|[\p{Cc}\p{Cf}]|(?:https?:|www\.)/iu.test(value)
  );
}

export function checkboxControl(
  control: Record<string, unknown>,
  composedLabels = false,
) {
  return (
    exactlyLocalControl(control, ['id', 'component', 'label', 'value']) &&
    control.component === 'CheckBox' &&
    (composedLabels
      ? plainLocalLabel(control.label)
      : control.label === localA2UICheckLabel) &&
    isObject(control.value) &&
    exactlyLocalControl(control.value, ['@path']) &&
    control.value['@path'] === localA2UICheckPath
  );
}

export function choiceControl(
  node: Record<string, unknown>,
  composedLabels = false,
) {
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
    (composedLabels
      ? plainLocalLabel(node.label)
      : node.label === localA2UIChoiceLabel) &&
    node.variant === 'mutuallyExclusive' &&
    Array.isArray(node.options) &&
    node.options.length === localA2UIChoices.length &&
    localA2UIChoices.every((option, index) => {
      const proposed: unknown = (node.options as unknown[])[index];
      return (
        isObject(proposed) &&
        exactlyLocalControl(proposed, ['label', 'value']) &&
        (composedLabels
          ? plainLocalLabel(proposed.label)
          : proposed.label === option.label) &&
        proposed.value === option.value
      );
    }) &&
    isObject(node.value) &&
    exactlyLocalControl(node.value, ['@path']) &&
    node.value['@path'] === localA2UIChoicePath
  );
}

/** Revalidate display-only metadata when the exact live plan is mounted. */
export function readComposedPairedLabels(value: unknown) {
  if (
    !isObject(value) ||
    !exactlyLocalControl(value, ['check', 'choice', 'options']) ||
    !plainLocalLabel(value.check) ||
    !plainLocalLabel(value.choice) ||
    !Array.isArray(value.options) ||
    value.options.length !== 2 ||
    !plainLocalLabel(value.options[0]) ||
    !plainLocalLabel(value.options[1])
  )
    return;
  const [first, second] = value.options as [string, string];
  if (first.normalize('NFC') === second.normalize('NFC')) return;
  return Object.freeze({
    check: value.check,
    choice: value.choice,
    options: Object.freeze([first, second] as const),
  });
}

/** The labels are display-only; the paths, option values and actions stay app-owned. */
export function composedPairedLabels(
  check: Record<string, unknown>,
  choice: Record<string, unknown>,
) {
  if (!checkboxControl(check, true) || !choiceControl(choice, true)) return;
  return readComposedPairedLabels({
    check: check.label,
    choice: choice.label,
    options: (choice.options as { label: string }[]).map(
      option => option.label,
    ),
  });
}
