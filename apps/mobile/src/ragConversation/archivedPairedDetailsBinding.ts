import type { ConversationA2UINode } from './conversationA2UI';
import type {
  createArchivedPairedDetailsOwner,
  MountedPairedDetailsMarker,
} from '../storage/archivedPairedDetailsOwner';

type Lease = Readonly<{ id: string; version: number }>;
type Bound = Readonly<{
  marker: MountedPairedDetailsMarker;
  lease: Lease;
  panels: readonly number[];
  verify: ReturnType<typeof createArchivedPairedDetailsOwner>;
}>;
const displayReaders = new WeakMap<ConversationA2UINode, Bound>();

/** Only the owning display reader binds the exact restored root. JSON copies,
 * live roots and other row objects cannot recover a read capability. */
export function bindArchivedPairedDetails(
  root: ConversationA2UINode,
  value: Bound,
) {
  displayReaders.set(root, value);
}

export function archivedPairedDetailsFor(root: ConversationA2UINode) {
  return displayReaders.get(root);
}
