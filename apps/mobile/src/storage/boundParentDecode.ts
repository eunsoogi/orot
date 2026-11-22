import {
  decodeConversationArtifact,
  type ConversationArtifact,
} from './conversationArtifactCodec';

// Hold one small-enough raw string and its private decode. Tiny intermediary
// turns still decode normally without evicting the one expensive snapshot.
const minimumUnits = 8 * 1024;
const maximumUnits = 256 * 1024;

export function createBoundParentDecode(owned: () => boolean) {
  let previous:
    { readonly raw: string; readonly value: ConversationArtifact } | undefined;
  return (raw: unknown) => {
    if (!owned()) {
      previous = undefined;
      return decodeConversationArtifact(raw);
    }
    if (
      typeof raw !== 'string' ||
      raw.length < minimumUnits ||
      raw.length > maximumUnits
    ) {
      return decodeConversationArtifact(raw);
    }
    if (previous?.raw === raw) return previous.value;
    const value = decodeConversationArtifact(raw);
    previous = value ? { raw, value } : undefined;
    return value;
  };
}
