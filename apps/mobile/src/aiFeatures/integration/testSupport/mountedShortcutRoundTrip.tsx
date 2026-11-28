import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';
import { runMigrations, type SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { useConversationSessions } from '../../../ragConversation/ConversationSessionsContext';
import type { ConversationSessions } from '../../../ragConversation/conversationSessions';
import { AiFeatureSharedNavigationStateProvider } from '../AiFeatureSharedNavigationState';
import { AiFeatureFlow } from '../AiFeatureFlow';
import type {
  AiFeatureServiceDependencies,
  AiFeatureServices,
} from '../featureServices';
import type { ExecutionConsentPort } from '@orot/agent-runtime';

export async function createMountedShortcutRoundTrip(
  setup: (database: SqlDatabase) => Promise<{
    services: AiFeatureServices;
    dependencies: AiFeatureServiceDependencies;
    consent: ExecutionConsentPort;
  }>,
  options: { readonly archiveOwner?: true } = {},
) {
  const folder = mkdtempSync(join(tmpdir(), 'orot-shortcut-round-trip-'));
  const file = join(folder, 'synthetic.sqlite');
  const prior = AppState.currentState;
  const motion = jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);

  AppState.currentState = 'active';
  let db = openSqliteTestDatabase(file);
  await runMigrations(db.database);
  let storage = createConversationArtifactStorage(db.database);
  let store!: ConversationSessions;
  let open: Awaited<ReturnType<typeof render>> | undefined;
  const route = {
    ...(options.archiveOwner
      ? { ownership: { isCurrent: () => true, subscribe: () => () => {} } }
      : {}),
    route: { name: 'rag-conversation' as const, key: 'synthetic-route' },
    push: jest.fn(),
    replace: jest.fn(),
    onBack: jest.fn(),
    onHome: jest.fn(),
    registerLeaveState: () => () => {},
  };
  const isCurrent = () => true;
  async function mount() {
    const { services, dependencies, consent } = await setup(db.database);
    function Scene() {
      store = useConversationSessions();
      return (
        <AiFeatureFlow
          consent={consent}
          services={services}
          serviceDependencies={dependencies}
          navigation={route}
          onOpenArticle={jest.fn()}
          isEntryCurrent={isCurrent}
        />
      );
    }
    open = await render(
      <AiFeatureSharedNavigationStateProvider
        conversationSessionOptions={services.conversationSessionOptions()}
      >
        <Scene />
      </AiFeatureSharedNavigationStateProvider>,
    );
    return open;
  }
  return {
    database: () => db.database,
    storage: () => storage,
    mount,
    async reopen(synchronize = true) {
      const [owner] = (await storage.listSessions()).items;
      if (!owner) throw new Error('The shortcut did not commit a session.');
      await open?.unmount();
      db.close();
      db = openSqliteTestDatabase(file);
      storage = createConversationArtifactStorage(db.database);
      const reopened = await mount();
      if (synchronize)
        await act(async () => {
          await store.synchronizeModel();
        });
      expect(await storage.activeSessionVersion(owner.id)).toBe(owner.version);
      expect(route.push).not.toHaveBeenCalled();
      return reopened;
    },
    async close() {
      await open?.unmount();
      db.close();
      AppState.currentState = prior;
      motion.mockRestore();

      rmSync(folder, { recursive: true, force: true });
    },
  };
}
