import type { OrdinaryConversationMemoryPort } from '../../ragConversation/ordinaryConversationMemoryTask';
import { saveOrdinaryConversationMemoryNote } from '../../storage/ordinaryConversationMemoryNote';

/** The genuine app uses its native shared protected database, not fixture data. */
export const appOrdinaryConversationMemory: OrdinaryConversationMemoryPort = {
  capture(scope) {
    // Admission must synchronously snapshot the device owner before its first
    // async DB lookup; a dynamic import here would open a grant-change gap.
    const owner =
      require('../../storage/ordinaryConversationMemoryDeviceOwner') as typeof import('../../storage/ordinaryConversationMemoryDeviceOwner');
    return scope === 'authored-routine'
      ? owner.authoredRoutineMemoryDeviceOwner.captureAdmission()
      : owner.captureOrdinaryConversationMemoryAdmission();
  },
  save: (capture, source, current) =>
    saveOrdinaryConversationMemoryNote(capture, source, true, current),
};
