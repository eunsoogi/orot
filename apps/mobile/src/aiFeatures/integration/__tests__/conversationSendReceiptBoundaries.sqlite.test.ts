import {
  installReceiptFixturePlatform,
  repointFixtureConversation,
  submitFixtureConversation,
} from '../testSupport/conversationReceiptFixturePlatform';
import { chatGPTCredentialMutation } from '../../../providers/chatGPTConsentIdentity';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import {
  createReceiptTestApp,
  instantFixture,
  receiptStageReached,
} from '../testSupport/conversationSendReceiptFixture';
import { createOpenAIPlanProvider } from '../../../providers/openai';
jest.mock('../../../providers/openai', () => ({
  ...jest.requireActual('../../../providers/openai'),
  createOpenAIPlanProvider: jest.fn(),
}));
test.each([
  ['composer', 'ready', false],
  ['choice', 'ready', false],
  ['composer', 'catalog-removed', false],
  ['choice', 'catalog-removed', false],
  ['composer', 'account-removed', false],
  ['choice', 'model-changed', false],
  ['composer', 'owner-deleted', false],
  ['composer', 'ready', true],
  ['choice', 'ready', true],
  ['choice', 'catalog-removed', true],
  ['composer', 'owner-deleted', true],
  ['composer', 'account-removed', true],
  ['composer', 'account-before-send', true],
  ['composer', 'cold', true],
  ['choice', 'model-changed', true],
  ['composer', 'credential-changed', true],
  ['composer', 'pointer-changed', true],
] as const)(
  'separates real local send boundaries: %s / %s / warm=%s',
  async (path, mode, warm) => {
    const f = instantFixture();
    const db = openSqliteTestDatabase(':memory:');
    const restorePlatform = installReceiptFixturePlatform(f.mark);
    const correction = warm ? 120 : 0;
    let releaseCredential: (() => void) | undefined;
    let store: ReturnType<typeof createConversationSessions> | undefined;
    try {
      await runMigrations(db.database);
      const artifactStorage = createConversationArtifactStorage(db.database);
      const normalModelSelection = jest.spyOn(
        artifactStorage,
        'continuousSession',
      );
      const storage = {
        ...artifactStorage,
        async readProtectedPromptHistory(
          ...args: Parameters<typeof artifactStorage.readProtectedPromptHistory>
        ) {
          f.mark('protected_history_enter');
          await f.history.hold();
          const result = await artifactStorage.readProtectedPromptHistory(
            ...args,
          );
          f.mark('protected_history_ready');
          return result;
        },
      };
      const {
        services,
        listModels,
        listAccounts,
        authorize,
        generate,
        change,
        assertNoColdResume,
      } = createReceiptTestApp(
        f,
        storage,
        jest.mocked(createOpenAIPlanProvider),
        warm,
      );
      const options = services.conversationSessionOptions();
      const beginTurn = options.retention?.beginTurn;
      if (!options.retention || !beginTurn)
        throw new Error('Expected real retention');
      const owned = createConversationSessions({
        ...options,
        retention: {
          ...options.retention,
          async beginTurn(id, signal) {
            f.mark('retention_enter');
            await f.retention.hold();
            const turn = await beginTurn(id, signal);
            f.mark('retention_ready');
            return turn;
          },
        },
      });
      store = owned;
      if (mode !== 'cold') await owned.synchronizeModel();
      const id = owned.getSnapshot().activeId;
      const session = () =>
        owned.getSnapshot().sessions.find(item => item.id === id)!;
      let sent = false;
      let read = false;
      let visible = false;
      const settle = f.until('request_settled');
      owned.subscribe(() => {
        const user = session().messages.find(
          message => message.role === 'user',
        );
        if (!sent && user?.deliveryPending) {
          sent = true;
          f.mark('sending_state');
        }
        if (!read && user?.delivery?.readAt) {
          read = true;
          f.mark('read_state');
        }
        if (!visible && session().pendingMessage?.initialResponse) {
          visible = true;
          f.mark('opening_state');
        }
        if (sent && !session().busy && !session().preparingSend)
          f.mark('request_settled');
      });
      const reached = (name: string, work: Promise<void>) =>
        receiptStageReached(name, work, () => ({
          marks: f.relative(),
          catalogs: listModels.mock.calls.length,
          busy: session().busy,
          preparing: session().preparingSend,
          errorPresent: Boolean(session().error),
        }));
      if (mode === 'account-before-send') change('account-removed');
      f.mark('submit');
      const work = submitFixtureConversation(
        owned,
        id,
        path,
        services.sendRagMessage,
      );
      if (mode === 'cold' || mode === 'account-before-send') {
        await work;
        expect(listModels).toHaveBeenCalledTimes(1);
        expect(normalModelSelection).toHaveBeenCalledTimes(1);
        expect(listAccounts).toHaveBeenCalledTimes(mode === 'cold' ? 1 : 2);
        expect(generate).not.toHaveBeenCalled();
        expect(sent || read).toBe(false);
        return;
      }
      if (!warm) {
        await reached('catalog.first.entered', f.catalog.first.entered);
        expect(Boolean(session().preparingQuickChoice)).toBe(path === 'choice');
        expect(session().messages).toHaveLength(0);
        f.elapse(120, f.catalog.first);
      }
      await reached('retention.entered', f.retention.entered);
      expect(session().messages[0]?.deliveryPending).toBe(true);
      if (mode === 'owner-deleted') {
        const lease = options.retention.activeLease(id);
        expect(lease).not.toBeNull();
        await storage.deleteSession(lease!.id);
      } else if (
        mode !== 'ready' &&
        mode !== 'credential-changed' &&
        mode !== 'pointer-changed'
      )
        change(mode);
      expect(listModels).toHaveBeenCalledTimes(warm ? 1 : 2);
      expect(normalModelSelection).toHaveBeenCalledTimes(warm ? 1 : 2);
      f.elapse(35, f.retention);
      if (mode !== 'account-removed' && mode !== 'owner-deleted') {
        await reached('catalog.second.entered', f.catalog.second.entered);
        expect(generate).not.toHaveBeenCalled();
        if (mode === 'credential-changed')
          releaseCredential = chatGPTCredentialMutation.begin();
        if (mode === 'pointer-changed') {
          await repointFixtureConversation(storage);
          const lease = options.retention.activeLease(id)!;
          expect(await storage.activeSessionVersion(lease.id)).toBe(
            lease.version,
          );
        }
        f.elapse(120, f.catalog.second);
      }
      if (mode !== 'ready') {
        await reached('settled', settle);
        expect(listModels).toHaveBeenCalledTimes(
          (mode === 'account-removed' || mode === 'owner-deleted' ? 2 : 3) -
            Number(warm),
        );
        expect(listAccounts).toHaveBeenCalledTimes(
          mode === 'owner-deleted' ? 2 : 3,
        );
        expect(authorize).not.toHaveBeenCalled();
        expect(generate).not.toHaveBeenCalled();
        expect(read).toBe(false);
        if (warm && mode === 'catalog-removed')
          await assertNoColdResume(options.retention.activeLease(id));
        return;
      }
      await reached('history.entered', f.history.entered);
      expect(generate).not.toHaveBeenCalled();
      f.elapse(50, f.history);
      await reached('authority.entered', f.authority.entered);
      expect(listModels).toHaveBeenCalledTimes(warm ? 2 : 3); // startup plus send catalogs
      expect(listAccounts).toHaveBeenCalledTimes(3);
      expect(generate).not.toHaveBeenCalled();
      f.elapse(70, f.authority);
      await reached('provider.started.entered', f.provider.started.entered);
      expect(read).toBe(false); // actual adapter call alone is not Read
      f.elapse(450, f.provider.started);
      await reached('provider.forwardedReceipt', f.provider.forwardedReceipt);
      expect(read).toBe(true);
      expect(visible).toBe(false); // a provider signal is not first visible text
      await reached('provider.output.entered', f.provider.output.entered);
      f.elapse(180, f.provider.output);
      await reached('final.entered', f.final.entered);
      expect(visible).toBe(true);
      expect(session().busy).toBe(true);
      f.elapse(90, f.final);
      await reached('settled', settle);
      const relative = f.relative();
      expect(relative).toMatchObject({
        sending_state: 120 - correction,
        retention_ready: 155 - correction,
        'conversation_history_preflight:started': 120 - correction,
        'conversation_history_preflight:completed': 120 - correction,
        protected_history_enter: 275 - correction,
        protected_history_ready: 325 - correction,
        bridge_dispatch: 395 - correction,
        bridge_verified_start: 845 - correction,
        read_state: 845 - correction,
        opening_state: 1025 - correction,
        request_settled: 1115 - correction,
      });
      expect(
        session().messages.some(message => message.role === 'assistant'),
      ).toBe(true);
    } finally {
      store?.dispose();
      releaseCredential?.();
      restorePlatform();
      db.close();
    }
  },
);
