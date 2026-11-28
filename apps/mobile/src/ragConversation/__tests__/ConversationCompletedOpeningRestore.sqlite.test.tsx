import {
  approveMountedContextualOpening,
  checkOpeningsRetireWithArchiveOwner,
  replaceContextualOpeningTestSelection,
} from '../testSupport/approveMountedContextualOpening';
import {
  act,
  render,
  within,
  type RenderResult,
} from '@testing-library/react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { reportObservation } from '../../aiFeatures/integration/testSupport/dailyReportFailureStageFixtures';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationRetentionBridge } from '../../aiFeatures/integration/conversationRetentionBridge';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { finishRagConversation } from '../../aiFeatures/integration/finishRagConversation';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import type { ConversationSender } from '../conversationSessionTypes';
import { Transcript, at } from '../testSupport/savedHistoryDisplayFixture';

const question = 'Synthetic completed question';
const answer = 'Synthetic validated final answer';
const opening = {
  callId: 'synthetic-opening',
  text: '함께 내용을 살펴볼게요.',
};

test.each([
  'journal',
  'legacy-event',
  'absent',
  'journal-revoked',
  'fresh-apple',
  'shortcut-apple',
  'stale-apple',
  'malformed-apple',
  'plan',
  'stale-plan',
] as const)(
  'reopens the owned completed turn with its exact opening, %s',
  async kind => {
    const dir = mkdtempSync(join(tmpdir(), 'orot-completed-opening-'));
    const path = join(dir, 'test.sqlite');
    const apple =
      kind === 'fresh-apple' ||
      kind === 'shortcut-apple' ||
      kind === 'stale-apple' ||
      kind === 'malformed-apple';
    const plan = kind === 'plan' || kind === 'stale-plan';
    const contextual = apple || plan;
    const removed = contextual || kind === 'journal-revoked';
    const writesV3 =
      kind === 'fresh-apple' || kind === 'malformed-apple' || kind === 'plan';
    const opened = kind !== 'absent' && !kind.startsWith('stale-');
    let savedOpening: typeof opening | undefined;
    try {
      const observe = (ui: RenderResult, expectedOpening: boolean) => {
        const sequence = ui.getAllByTestId(
          'conversation-assistant-steering-sequence',
        );
        expect(sequence).toHaveLength(1);
        const rendered = within(sequence[0]!);
        const final = rendered.getByText(answer);
        const first = rendered.queryByText(opening.text);
        const collect = (node: (typeof sequence)[number]): string[] => {
          if (node === first) return [opening.text];
          if (node === final) return [answer];
          return node.children.flatMap(child =>
            typeof child === 'string' ? [] : collect(child),
          );
        };
        // Traverse the mounted row to verify bubble order without animation timing.
        expect(collect(sequence[0]!)).toEqual(
          expectedOpening ? [opening.text, answer] : [answer],
        );
      };
      {
        const connection = openSqliteTestDatabase(path);
        await runMigrations(connection.database);
        if (removed)
          await createRecordRepository(connection.database).put(
            'health_observation',
            reportObservation,
          );
        const storage = createConversationArtifactStorage(connection.database);
        const ids = ['synthetic-session', 'synthetic-turn'];
        const sessions = createConversationSessions({
          retention: createConversationSessionRetention({
            openStorage: async () => storage,
            now: () => at(1),
            createId: () => ids.shift()!,
          }),
        });
        const ui = await render(<Transcript store={sessions} />);
        try {
          const sender: ConversationSender = async (
            prompt,
            _history,
            signal,
            observer,
          ) => {
            if (!signal) throw new Error('Missing owned signal.');
            if (kind === 'journal' || kind === 'journal-revoked')
              await expect(
                observer?.onReviewedOpening?.(opening, signal),
              ).resolves.toBe(true);
            else if (kind === 'legacy-event')
              observer?.onTaskStreamEvent?.({
                type: 'initial_response',
                ...opening,
              });
            if (contextual) {
              await approveMountedContextualOpening(
                prompt,
                opening.text,
                observer,
                signal,
                kind === 'shortcut-apple' ? 'shortcut' : 'composer',
                kind.startsWith('stale-'),
                plan,
              );
            }
            const retention = createConversationRetentionBridge({
              signal,
              observer,
              question: prompt,
              providerId: 'fixture-provider',
              modelId: 'fixture-model',
              registry: new LocalEvidenceReferenceRegistry(),
            });
            retention.onValidatedEvidence([]);
            return finishRagConversation({
              outcome: { status: 'answer', answer, citations: [] },
              publicSearch: { status: 'success' },
              retention,
              signal,
              continuation: false,
            });
          };
          await act(async () => {
            sessions.setDraft(1, question);
            await sessions.send(1, sender);
          });
          observe(ui, opened);
          const raw = await connection.database.execute(
            'SELECT result_json FROM conversation_artifacts',
          );
          expect(raw.rows).toHaveLength(1);
          const saved = JSON.parse(String(raw.rows[0]?.result_json));
          savedOpening = saved.initialResponse;
          if (!opened) expect(savedOpening).toBeUndefined();
          else
            expect(saved.initialResponse).toMatchObject({ text: opening.text });
          if (contextual && opened) {
            const check = await connection.database.execute(
              'SELECT reviewed_opening_json FROM conversation_requests',
            );
            expect(
              JSON.parse(String(check.rows[0]?.reviewed_opening_json)).kind,
            ).toBe(
              writesV3
                ? 'reviewed-authored-contextual-opening-v3'
                : 'reviewed-prompt-opening-v1',
            );
          }
        } finally {
          await ui.unmount();
          sessions.dispose();
          connection.close();
        }
      }
      {
        const connection = openSqliteTestDatabase(path);
        if (removed)
          expect(
            await createRecordRepository(connection.database).delete(
              'health_observation',
              reportObservation.id,
            ),
          ).toBe(true);
        if (writesV3)
          await replaceContextualOpeningTestSelection(kind === 'plan');
        if (kind === 'malformed-apple')
          await connection.database.execute(
            "UPDATE conversation_requests SET reviewed_opening_json = json_set(reviewed_opening_json, '$.unexpected', true)",
          );
        const storage = createConversationArtifactStorage(connection.database);
        const reader = conversationSavedHistoryDisplayOption(
          async () => storage,
        );
        const sessions = createConversationSessions({
          retention: createConversationSessionRetention({
            openStorage: async () => storage,
            now: () => at(2),
            createId: () => 'unexpected-request',
          }),
          readSavedHistoryDisplay: reader,
          restoreSession: async () => {
            throw new Error('unexpected strict reader');
          },
          restoreSessionPage: async () => {
            throw new Error('unexpected strict page');
          },
        });
        const ui = await render(<Transcript store={sessions} />);
        try {
          await act(async () => {
            await sessions.attachExisting('synthetic-session', 0, at(1));
          });
          const restored = await reader(
            'synthetic-session',
            0,
            new AbortController().signal,
          );
          const expectedOpening =
            opened && (!removed || kind === 'fresh-apple' || kind === 'plan');
          expect(restored.rows).toEqual([
            expect.objectContaining({ kind: 'answer', answer }),
          ]);
          const row = restored.rows[0];
          expect(
            row && 'initialResponse' in row ? row.initialResponse : undefined,
          ).toEqual(expectedOpening ? savedOpening : undefined);
          observe(ui, expectedOpening);
          if (kind === 'fresh-apple' || kind === 'plan')
            await checkOpeningsRetireWithArchiveOwner(storage, reader);
        } finally {
          await ui.unmount();
          sessions.dispose();
          connection.close();
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
