import type { AiFeatureLocalData } from './localData';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';

type Discovery = { readonly read: unknown };
type Storage = Pick<
  ReturnType<typeof createConversationArtifactStorage>,
  'read'
>;
const owners = new WeakMap<
  Discovery,
  {
    storage: Storage;
    data: AiFeatureLocalData;
    read: Discovery['read'];
    storageRead: Storage['read'];
  }
>();

/** Only the actual factory can lend its initial strict parent hydration. Custom
 * readers and late replacements keep their own policy callback, never a shortcut. */
export function registerConversationParentReadOwner(
  discovery: Discovery,
  storage: Storage,
  data: AiFeatureLocalData,
) {
  owners.set(discovery, {
    storage,
    data,
    read: discovery.read,
    storageRead: storage.read,
  });
}

export function ownsConversationParentRead(
  discovery: Discovery | undefined,
  storage: Storage,
  data: AiFeatureLocalData,
): boolean {
  const owner = discovery && owners.get(discovery);
  return Boolean(
    owner &&
    owner.storage === storage &&
    owner.data === data &&
    owner.read === discovery!.read &&
    owner.storageRead === storage.read,
  );
}
