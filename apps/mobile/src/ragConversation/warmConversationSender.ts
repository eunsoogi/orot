import type { ConversationSender } from './conversationSessionTypes';

const warmSenders = new WeakSet<ConversationSender>();

/** Only app-authored ordinary/Possibilities entry bindings opt into warm local preparation. */
export function allowWarmConversationSender(sender: ConversationSender) {
  warmSenders.add(sender);
  return sender;
}

export function isWarmConversationSender(sender: ConversationSender) {
  return warmSenders.has(sender);
}
