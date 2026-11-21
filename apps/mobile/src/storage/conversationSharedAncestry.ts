import type { SqlExecutor } from '@orot/storage';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';

export type ConversationAncestryParent = {
  readonly id: string;
  readonly revision: string;
};
type ConversationAncestryFootprint = {
  readonly id: string;
  readonly descendants: Set<string>;
  height: number;
  visits: number;
  cacheable: boolean;
};
type AncestryScope = {
  tx: SqlExecutor;
  current(): boolean;
  parents: Map<string, ConversationAncestryFootprint>;
};

/** Scope access is possible only within the exact verified read. Its owner is
 * responsible for settling the complete transaction witness before publication
 * and replaying the original pass on drift. This token carries no saved content. */
export type ConversationSharedAncestry = Readonly<{
  kind: 'conversation_shared_ancestry';
}>;
const scopes = new WeakMap<ConversationSharedAncestry, AncestryScope>();

export function createConversationSharedAncestry(
  tx: SqlExecutor,
  current: () => boolean,
): ConversationSharedAncestry {
  const token = Object.freeze({
    kind: 'conversation_shared_ancestry' as const,
  });
  scopes.set(token, { tx, current, parents: new Map() });
  return token;
}

const maxDepth = 16;
const maxVisits = 128;
const maxParents = 128;
const maxIdentifierLength = 200;
const parentKey = ({ id, revision }: ConversationAncestryParent) =>
  id.length <= maxIdentifierLength && revision.length <= 512
    ? JSON.stringify([id, revision])
    : undefined;

function includeBranch(
  parent: ConversationAncestryFootprint | undefined,
  child: ConversationAncestryFootprint,
) {
  if (!parent) return;
  parent.visits += child.visits;
  parent.height = Math.max(parent.height, child.height + 1);
  if (!child.cacheable) {
    parent.cacheable = false;
    parent.descendants.clear();
  }
  if (parent.cacheable)
    for (const id of child.descendants) parent.descendants.add(id);
}

/** A hit replays the original structural cost only, not the DB work. A
 * footprint counts repeated descendants with multiplicity and rejects cache
 * shortcuts that would cross the original path, depth, or per-root visit cap. */
export function createConversationAncestryTraversal(
  tx: SqlExecutor,
  token?: ConversationSharedAncestry,
) {
  const candidate = token && scopes.get(token);
  const scope = candidate?.tx === tx ? candidate : undefined;
  const path = new Set<string>();
  const stack: ConversationAncestryFootprint[] = [];
  let visited = 0;
  return {
    get depth() {
      return path.size;
    },
    enter(id: string) {
      if (path.has(id) || path.size >= maxDepth || ++visited > maxVisits)
        throw new RetainedSourceInvalidError(
          'Conversation ancestry is cyclic or too large.',
        );
      path.add(id);
      if (scope) {
        const cacheable = id.length <= maxIdentifierLength;
        stack.push({
          id,
          cacheable,
          descendants: new Set(cacheable ? [id] : []),
          height: 1,
          visits: 1,
        });
      }
    },
    leave(id: string, expected?: ConversationAncestryParent) {
      path.delete(id);
      const child = stack.pop();
      if (!child) return;
      includeBranch(stack.at(-1), child);
      // Oversized imported identifiers remain strict without extending their
      // lifetime across roots, including through an eligible ancestor.
      if (
        !child.cacheable ||
        !expected ||
        child.id !== expected.id ||
        !scope?.current()
      )
        return;
      const key = parentKey(expected);
      if (key && scope.parents.size < maxParents) scope.parents.set(key, child);
    },
    reuse(parent: ConversationAncestryParent) {
      if (!scope?.current()) return false;
      const key = parentKey(parent);
      const child = key && scope.parents.get(key);
      if (
        !child ||
        path.size + child.height > maxDepth ||
        visited + child.visits > maxVisits ||
        [...path].some(id => child.descendants.has(id))
      )
        return false;
      includeBranch(stack.at(-1), child);
      visited += child.visits;
      return true;
    },
  };
}
