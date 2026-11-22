import type { ProviderSelection, SavedSelectionTitle } from './types';

/** Presentation is not a credential or an authority input. Validate it
 * independently so corrupted copy never invalidates an otherwise valid choice. */
export function parseTitle(
  value: unknown,
  selection: ProviderSelection,
): SavedSelectionTitle | undefined {
  if (
    !selection.providerId.startsWith('chatgpt-plan:') ||
    !value ||
    typeof value !== 'object'
  )
    return;
  const { name, epoch } = value as Partial<SavedSelectionTitle>;
  if (
    typeof name !== 'string' ||
    name.trim() !== name ||
    !name ||
    name.length > 120 ||
    name === selection.modelId ||
    name.includes(selection.providerId) ||
    /[\p{C}\p{Zl}\p{Zp}]/u.test(name) ||
    typeof epoch !== 'string' ||
    epoch.trim() !== epoch ||
    !epoch ||
    epoch.length > 128
  )
    return;
  return { name, epoch };
}
