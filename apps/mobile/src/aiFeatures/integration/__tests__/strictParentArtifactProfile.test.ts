import { createAiFeatureServices } from '../featureServices';
import { consent } from '../featureServiceFixtures';
import { createConversationLocalAccess } from '../conversationLocalAccess';
import { createConversationSessionStorage } from '../conversationSessionStorage';
import { sharedAncestryProfileFixture } from '../testSupport/sharedAncestryProfileFixture';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { registerConversationReadOperation } from '../conversationReadOperation';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';

import { fingerprint } from '../evidenceUtils';
import type { AiFeatureLocalData } from '../localData';
/** Real service restoration must not recalculate a native parent's report at each strict fence. */
test.each([1, 2])(
  'strict native parent depth %i shares calculations, never native validity',
  async depth => {
    const f = await sharedAncestryProfileFixture(1, false);
    const data: AiFeatureLocalData = await f.input.loadLocalData();
    Object.assign(data, {
      readHealthContext: createLocalEvidenceData(f.database).readHealthContext!,
    });
    registerConversationReadOperation(data, async (scoped, registry) =>
      createSummaryArtifactDiscovery({
        database: f.database,
        storage: createSymptomSummaryStorage(f.database),
        data: scoped,
        registry,
      }),
    );
    const artifact = (await f.storage.read('turn-0'))!;
    const validate = jest.fn(async () => true);
    data.validateConversationPhotoInput = validate;
    const parent = {
      ...artifact,
      id: 'native-parent',
      submittedInput: {
        schemaVersion: 1 as const,
        inputRevision: 1,
        sessionId: 'session',
        requestId: 'native-parent',
        question: artifact.question,
        ocr: {
          providerId: 'synthetic',
          modelId: 'synthetic',
          recipient: 'synthetic',
          remoteProcessing: false,
          consentScope: {
            purpose: 'conversation',
            policyVersion: 'v1',
            dataCategories: ['ocr'],
          },
          source: {
            id: '12345678-1234-4234-8234-123456789abc',
            contentHash: `sha256:${'a'.repeat(64)}` as const,
          },
          deletionGeneration: 0,
          sections: [
            { id: 'section', text: 'synthetic', startOffset: 0, endOffset: 9 },
          ],
        },
      },
    };
    await f.storage.startRequest({
      id: parent.id,
      sessionId: 'session',
      sessionVersion: 0,
      question: parent.question,
      createdAt: parent.createdAt,
      submittedInput: parent.submittedInput,
    });
    await f.storage.append(parent);
    const revision = fingerprint(parent);
    const reference = {
      ...artifact.citations![0]!,
      sourceId: parent.id,
      evidenceId: parent.id,
      sourceRevision: revision,
      evidenceRevision: revision,
      locator: { kind: 'generated_artifact', type: 'conversation_turn' },
    };
    await f.storage.append({
      ...artifact,
      id: 'native-child',
      sources: [
        { kind: 'generated_conversation', id: parent.id, revision, reference },
      ],
      citations: [reference],
    });
    if (depth === 2) {
      const child = (await f.storage.read('native-child'))!;
      const childRevision = fingerprint(child);
      const childReference = {
        ...reference,
        sourceId: child.id,
        evidenceId: child.id,
        sourceRevision: childRevision,
        evidenceRevision: childRevision,
      };
      await f.storage.append({
        ...artifact,
        id: 'native-grandchild',
        sources: [
          {
            kind: 'generated_conversation',
            id: child.id,
            revision: childRevision,
            reference: childReference,
          },
        ],
        citations: [childReference],
      });
    }
    // Match the shipping localData composition rather than injecting one raw store.
    const nativeTransaction = f.database.transaction.bind(f.database);
    let queue = Promise.resolve();
    f.database.transaction = work => {
      const next = queue.then(() => nativeTransaction(work));
      queue = next.catch(() => undefined);
      return next;
    };
    Object.assign(
      data,
      createConversationLocalAccess(f.database, () => data, {
        storage: async () =>
          jest.requireActual('../../../storage/conversationArtifactStorage'),
        notifications: async () =>
          jest.requireActual(
            '../../../replyNotifications/replyNotificationStorage',
          ),
        discovery: async () =>
          jest.requireActual('../conversationArtifactDiscovery'),
      }),
    );
    const open = createConversationSessionStorage(f.input.loadLocalData);
    await open();
    // Invalidate the bounded global report cache without changing this source window.
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'future-profile',
      effectiveAt: '2027-01-01T00:00:00Z',
      ingestedAt: '2027-01-01T00:00:00Z',
      recordedAt: '2027-01-01T00:00:00Z',
    });
    const services = createAiFeatureServices(consent, {
      loadLocalData: async () => data,
    });
    const options = services.conversationSessionOptions();
    const transaction = f.database.transaction.bind(f.database);
    const queries = new Map<string, number>();
    let aggregateMs = 0;
    let allSqlMs = 0;
    let sqlCount = 0;
    f.database.transaction = work =>
      transaction(async tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = async (...args) => {
          const start = performance.now();
          const result = await execute(...args);
          const elapsed = performance.now() - start;
          allSqlMs += elapsed;
          sqlCount++;
          if (/WITH days\(/.test(args[0])) {
            aggregateMs += elapsed;
            const key = JSON.stringify(args);
            queries.set(key, (queries.get(key) ?? 0) + 1);
          }
          return result;
        };
        await work(tx);
      });
    try {
      const page = await options.restoreSessionPage!(
        'session',
        new AbortController().signal,
      );
      expect(page.turns).toHaveLength(2 + depth);
      expect(page.turns.every(turn => turn.answer === artifact.answer)).toBe(
        true,
      );
      expect(validate).toHaveBeenCalledTimes(2 + 2 * depth);

      console.info(
        'SYNTHETIC_STRICT_PARENT_HISTORY',
        JSON.stringify({
          uniqueQueries: queries.size,
          aggregateMs,
          allSqlMs,
          sqlCount,
          exactRepeatCounts: [...queries.values()],
        }),
      );
      expect([...queries.values()]).toEqual([1, 1]);
      const childTurn = page.turns.find(
        turn => turn.toolMessageId === 'native-child',
      )!;
      const alias = childTurn.citations[0]!;
      validate.mockResolvedValue(false);
      expect(
        (await services.readSource(alias, new AbortController().signal)).status,
      ).not.toBe('available');
      const changed = await options.restoreSessionPage!(
        'session',
        new AbortController().signal,
      );
      expect(
        changed.turns.some(
          turn =>
            turn.toolMessageId === 'turn-0' && turn.answer === artifact.answer,
        ),
      ).toBe(true);
      expect(
        changed.turns.filter(
          turn =>
            turn.toolMessageId?.startsWith('native-') &&
            turn.answer === artifact.answer,
        ),
      ).toEqual([]);
      validate.mockResolvedValue(true);
      await f.repository.delete('health_observation', f.inside.id);
      const afterDelete = await options.restoreSessionPage!(
        'session',
        new AbortController().signal,
      );
      // Every source window above contains the deleted contributor. Remaining
      // rows may only be metadata notices, never the original protected answer.
      expect(
        afterDelete.turns.filter(turn => !turn.historyUnavailable),
      ).toEqual([]);
      for (const turn of afterDelete.turns) {
        expect(turn.question).toBe('');
        expect(turn.answer).not.toBe(artifact.answer);
        expect(turn.citations).toEqual([]);
      }
    } finally {
      f.database.transaction = transaction;
      f.close();
    }
  },
);
