import { conversationHistoryPageOption } from './conversationHistoryPageOption';
import { restoreConversationSessionTurns } from './restoreConversationSessionTurns';
import type { ConversationSessionOptionInput } from './conversationSessionOptionInput';
import { continuousSessionOption } from './continuousSessionOption';
import { restoreConversationSteering } from './restoreConversationSteering';
import { createConversationSessionRetention } from '../../ragConversation/conversationSessionRetention';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import { createConversationDurableIdentity } from '../../ragConversation/conversationDurableIdentity';
import { captureConversationToolSources } from './captureConversationToolSources';
import { conversationStoredToolObserver } from './conversationStoredToolObserver';
import { createTreatmentSourceResolver } from './resolveTreatmentSource';
import { restoreConversationTaskCards } from './restoreConversationTaskCards';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { createConversationSessionStorage } from './conversationSessionStorage';
import { conversationPhotoPreparationOption } from './conversationPhotoPreparation';
/** Bind the app-owned session store to encrypted writes and source-checked restoration. */
export function createConversationSessionOptions(
  input: ConversationSessionOptionInput,
): ConversationSessionOptions {
  const openStorage = createConversationSessionStorage(input.loadLocalData);
  const photo = conversationPhotoPreparationOption(input);
  return {
    ...photo,
    readPlainContextPage: async (...args) =>
      (await openStorage()).readPlainContextPage(...args),
    restoreSessionPage: conversationHistoryPageOption(input, openStorage),
    ...continuousSessionOption(input.selectedAi, openStorage),
    restoreSteering: restoreConversationSteering(openStorage),
    coldResume: input.coldResume,
    execution: conversationExecutionNative() ?? undefined,
    listSessions: async cursor => (await openStorage()).listSessions(cursor),
    restoreTasks: async (sessionId, signal) => {
      const storage = await openStorage();
      return restoreConversationTaskCards(storage, sessionId, signal);
    },
    resolveTreatmentSource: createTreatmentSourceResolver(input),
    retention: createConversationSessionRetention({
      openStorage,
      createId: createConversationDurableIdentity,
      now: () => new Date().toISOString(),
      retirePhoto: photo.photoPreparation?.retirement.retire,
      captureToolSources: async (event, sessionId) =>
        captureConversationToolSources(
          event,
          input.registry,
          await openStorage(),
          sessionId,
        ),
      onToolEventStored: conversationStoredToolObserver(
        openStorage,
        input.loadLocalData,
        input.registry,
      ),
    }),
    restoreSession: (sessionId, signal) =>
      restoreConversationSessionTurns(input, openStorage, sessionId, signal),
  };
}
