import type { ConversationA2UINode } from './conversationA2UI';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from './conversationA2UIArchive';
import type { ArchivedA2UILayout } from './conversationA2UIArchive';
import { conversationA2UIModalFor } from './conversationA2UIModalWire';

export type ArchivedPairedDetailsLayout = Readonly<{
  version: 8;
  base: ArchivedA2UILayout;
  panels: readonly number[];
}>;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: object, fields: string[]) =>
  Object.keys(value).length === fields.length &&
  fields.every(field => Object.hasOwn(value, field));

/** The archived flag is local shape, not a dialog grant. The existing saver
 * still verifies prose; the caller may choose v8 only after proving no lineage. */
export function storePairedDetails(
  root: ConversationA2UINode,
  answer: string,
): ArchivedPairedDetailsLayout | undefined {
  if (root.component !== 'Column') return undefined;
  const exact = storeConversationA2UILayout(root, answer);
  if (!exact || !Array.isArray(exact.tree) || exact.tree[0] !== 'Column')
    return;
  const panels = root.children.flatMap((child, index) =>
    conversationA2UIModalFor(child) ? [index] : [],
  );
  if (panels.length !== 2) return;
  return { version: 8, base: exact, panels };
}

/** Read the existing accepted prose only. A v8 reconstruction is intentionally
 * not annotated as a live Modal; a native owner must admit a specific tap. */
export function readPairedDetails(value: unknown, answer: string) {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['version', 'base', 'panels']) ||
    value.version !== 8 ||
    !Array.isArray(value.panels) ||
    value.panels.length !== 2 ||
    !isRecord(value.base) ||
    value.base.version === 8
  )
    return;
  const [first, second]: unknown[] = value.panels;
  if (
    typeof first !== 'number' ||
    typeof second !== 'number' ||
    !Number.isInteger(first) ||
    !Number.isInteger(second) ||
    first < 0 ||
    first >= second
  )
    return;
  const root = restoreConversationA2UILayout(value.base, answer);
  if (root?.component !== 'Column') return;
  function panel(index: number) {
    const child =
      root?.component === 'Column' ? root.children[index] : undefined;
    if (
      child?.component !== 'Column' ||
      child.children.length !== 2 ||
      child.children[0].component !== 'Text'
    )
      return;
    return { trigger: child.children[0], body: child.children[1] };
  }
  const left = panel(first);
  const right = panel(second);
  return left && right
    ? {
        root,
        panels: [left, right] as const,
        positions: [first, second] as const,
      }
    : undefined;
}
