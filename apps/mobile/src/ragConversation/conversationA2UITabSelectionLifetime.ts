import type { TaskResponderContract } from '@orot/agent-runtime';
import type { ConversationA2UINode } from './conversationA2UI';
import {
  conversationA2UIComposedControl,
  type ComposedControl,
} from './conversationA2UIComposedControlState';
import type { GroundedRagAnswer } from './task';

const eligible = new WeakMap<
  ConversationA2UINode,
  ReadonlySet<ComposedControl>
>();

type LocalSelection = boolean | readonly string[];
export interface ConversationA2UITabSelections {
  readonly resetRevision: number;
  read(control: ComposedControl): LocalSelection | undefined;
  write(control: ComposedControl, value: LocalSelection): void;
  retire(): boolean;
  isRetired(): boolean;
  requestReplacement(): boolean;
}

/** Create only local draft state for an exact mounted/foreground form stamp.
 * The renderer releases the map on reset, retirement or root replacement. */
export function createConversationA2UITabSelections(
  root: ConversationA2UINode,
  resetRevision: number,
): ConversationA2UITabSelections | undefined {
  const fields = eligible.get(root);
  if (!fields) return;
  const values = new Map<ComposedControl, LocalSelection>();
  let current = true;
  let requested = false;
  return {
    resetRevision,
    read: control => (current ? values.get(control) : undefined),
    write(control, value) {
      if (current && fields.has(control)) values.set(control, value);
    },
    isRetired: () => !current,
    requestReplacement() {
      if (current || requested) return false;
      requested = true;
      return true;
    },
    retire() {
      if (!current) return false;
      current = false;
      // Remount only to clear populated field state. A new empty map can
      // see the same inactive owner before React publishes the new snapshot.
      const hadSelections = values.size > 0;
      values.clear();
      return hadSelections;
    },
  };
}

/**
 * Retirement is permanent. A batched loss and return may keep React's same
 * stamp, so positive reacquisition replaces that retired map rather than
 * reopening it. Never refresh an empty map while the owner is still absent.
 */
export function watchConversationA2UITabSelections(input: {
  readonly selections: ConversationA2UITabSelections;
  readonly isCurrent: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  readonly refresh: () => void;
}) {
  let listening = true;
  const reconcile = () => {
    if (!listening) return;
    const shouldRefresh = input.isCurrent()
      ? input.selections.isRetired()
      : input.selections.retire();
    if (shouldRefresh && input.selections.requestReplacement()) input.refresh();
  };
  const stop = input.subscribe(reconcile);
  reconcile();
  return () => {
    listening = false;
    stop();
  };
}

/** Record only already-admitted Boolean/Choice nodes inside Tabs. The wire
 * protocol, existing parser and trusted visible answer are unchanged. */
export function withConversationA2UITabSelectionLifetime(
  previous: TaskResponderContract<GroundedRagAnswer>,
  version: '56' | '57' | '58' = '56',
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: version,
    validateResult(value, input) {
      const result = previous.validateResult(value, input);
      if (
        result.status !== 'valid' ||
        result.value.answerKind !== 'conversation'
      )
        return result;
      const root = result.value.a2uiPresentation;
      if (!root) return result;
      const fields = new Set<ComposedControl>();
      function visit(node: ConversationA2UINode, insideTab: boolean) {
        const control = insideTab
          ? conversationA2UIComposedControl(node)
          : undefined;
        if (control?.kind === 'check' || control?.kind === 'choice')
          fields.add(control);
        if (node.component === 'Tabs')
          node.tabs.forEach(tab => visit(tab.child, true));
        else if ('children' in node)
          node.children.forEach(child => visit(child, insideTab));
      }
      visit(root, false);
      if (fields.size > 0) eligible.set(root, fields);
      return result;
    },
  };
}
