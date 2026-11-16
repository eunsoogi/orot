import { createConversationSessions } from '../conversationSessions';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';

export async function setup() {
  const f = await healthContextFixture();
  const storage = createConversationArtifactStorage(f.database);
  let model = 'a';
  let counter = 0;
  const options = {
    continuousSession: async (signal: AbortSignal) => ({
      model: { providerId: 'synthetic', modelId: model },
      ...(await storage.continuousSession(
        { providerId: 'synthetic', modelId: model },
        `session-${++counter}`,
        '2026-11-16T00:00:00.000Z',
        signal,
      )),
    }),
    retention: createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `extra-${++counter}`,
      now: () => '2026-11-16T00:00:00.000Z',
    }),
    restoreSession: async () => [],
  };
  const store = createConversationSessions(options);
  return {
    ...f,
    storage,
    options,
    store,
    select: (value: string) => {
      model = value;
    },
  };
}
