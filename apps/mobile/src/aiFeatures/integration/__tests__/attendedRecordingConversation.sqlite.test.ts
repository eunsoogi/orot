import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { recordingClarificationForLiveTurn } from '../../../ragConversation/conversationRecordingClarification';
import { createRagConversationService } from '../ragConversationService';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import {
  other,
  withRecordings,
} from '../testSupport/selectedRecordingSqliteFixture';
import type { SqlDatabase } from '@orot/storage';

// Use the same lazy-module lowering as the app's other protected SQLite composition tests.
function mockCompileTimestampProof() {
  const { readFileSync } = require('node:fs');
  const { dirname, resolve } = require('node:path');
  const { runInNewContext } = require('node:vm');
  const { transformSync } = require('@babel/core');
  const resolveModule = (
    require as NodeRequire & {
      resolve(name: string, options?: { paths: string[] }): string;
    }
  ).resolve;
  const filename = resolveModule('../selectedRecordingTimestampProof');
  const transformed = transformSync(readFileSync(filename, 'utf8'), {
    filename,
    babelrc: false,
    configFile: false,
    presets: [resolveModule('@react-native/babel-preset')],
    plugins: [
      resolveModule('@babel/plugin-transform-dynamic-import', {
        paths: [resolveModule('@babel/preset-env')],
      }),
    ],
  });
  const module = { exports: {} };
  runInNewContext(transformed.code, {
    module,
    exports: module.exports,
    require: (name: string) =>
      require(name.startsWith('.') ? resolve(dirname(filename), name) : name),
  });
  return module.exports;
}
jest.mock('../selectedRecordingTimestampProof', () =>
  mockCompileTimestampProof(),
);

let mockDatabase: SqlDatabase | undefined;
let mockNativeCurrent = true;
jest.mock('../../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: async () => mockDatabase,
  openLocalStorage: async () =>
    jest.requireActual('@orot/storage').createRecordRepository(mockDatabase),
  isCurrentLocalAgentMemoryDatabase: (value: SqlDatabase) =>
    !!mockDatabase && value === mockDatabase,
}));
jest.mock('../../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: () => ({
    bridgeAvailable: true,
    protectedDataAvailable: async () => mockNativeCurrent,
  }),
}));

const timestamp = '2090-01-01T00:10:00.000Z';
const original = 'What did the saved recording say?';
it.each(['valid', 'stale', 'denied', 'revoked', 'recipient-changed'] as const)(
  '%s: actual sender, receipt, protected selector and model transport',
  mode =>
    withRecordings(
      async (data, _correct, _storage, database) => {
        mockNativeCurrent = true;
        mockDatabase = database;
        await database.execute(
          "UPDATE source_records SET recorded_at=?, payload_json=json_set(payload_json,'$.recordedAt',?) WHERE id=?",
          ['2090-01-03T00:10:00Z', '2090-01-03T00:10:00Z', other],
        );
        const owner = {};
        let modelScope = 'active';
        let onInvalidated: (() => void) | undefined;
        let phase = 'ask';
        let modelAuthorize = 0;
        const fake = publicEvidenceFixture();
        const generate = jest.fn(async (req: LanguageModelRequest) => {
          if (phase === 'ask')
            return providerSuccess({
              text: '',
              toolCalls: [
                {
                  id: 'clarify',
                  name: 'local-saved-recording-transcript',
                  arguments: {},
                },
              ],
              finishReason: 'tool_calls' as const,
            });
          return providerSuccess({
            text: '',
            toolCalls: [
              {
                id: 'transcript',
                name: 'local-saved-recording-transcript',
                arguments: { query: 'synthetic transcript' },
              },
            ],
            finishReason: 'tool_calls' as const,
          });
        });
        const provider = {
          ...fake.selected.provider,
          generate,
          capabilities: {
            ...fake.selected.provider.capabilities,
            toolCalling: true,
            streaming: false,
            structuredOutput: false,
          },
        };
        const consent = {
          authorize: async () => {
            modelAuthorize++;
            return phase === 'lookup' && mode === 'denied'
              ? ('renewal_required' as const)
              : ('authorized' as const);
          },
          isAuthorizationCurrent: () =>
            !(phase === 'lookup' && mode === 'revoked'),
          subscribeAuthorizationInvalidation: () => () => {},
        };
        const read = jest.spyOn(data, 'readCandidates');
        const send = createRagConversationService({
          consent,
          queryConsent: { authorize: async () => 'denied' },
          externalEvidence: { search: jest.fn() },
          loadLocalData: async () => ({
            ...data,
            loadMemoryRecords: async () => [],
          }),
          selectedAi: async () => ({
            ...fake.selected,
            provider,
            recipient:
              phase === 'lookup' && mode === 'recipient-changed'
                ? 'Other synthetic recipient'
                : fake.selected.recipient,
          }),
          registry: new LocalEvidenceReferenceRegistry(),
          ragRunner: runRagConversationTurn,
        });
        function observer(question: string) {
          const key = modelScope;
          return {
            inputOrigin: 'composer' as const,
            recordingClarification: recordingClarificationForLiveTurn(
              owner,
              1,
              {
                key,
                question,
                current: () => modelScope === key,
                protectedCurrent: async () => mockNativeCurrent,
                subscribeInvalidation: listener => {
                  onInvalidated = listener;
                  return () => {
                    onInvalidated = undefined;
                  };
                },
              },
            ),
          };
        }
        const first = await send(original, [], undefined, observer(original));
        expect(first).toEqual({
          status: 'insufficient',
          guidance: 'recording_selector',
        });
        expect(read).not.toHaveBeenCalled();
        expect(generate).toHaveBeenCalledTimes(1);
        phase = 'lookup';
        const next = observer(timestamp);
        expect(next.recordingClarification.reply?.originalQuestion).toBe(
          original,
        );
        if (mode === 'stale') modelScope = 'new';
        const result = await send(timestamp, [], undefined, next);
        if (mode === 'valid') {
          expect(generate.mock.calls.length).toBeGreaterThan(1);
          expect(JSON.stringify(generate.mock.calls[1])).toContain(original);
          expect(JSON.stringify(generate.mock.calls.slice(1))).toContain(
            'Synthetic transcript selected revision',
          );
          expect(JSON.stringify(generate.mock.calls.slice(1))).not.toContain(
            'Synthetic transcript foreign',
          );
          const count = generate.mock.calls.length;
          await send(timestamp, [], undefined, next);
          expect(generate).toHaveBeenCalledTimes(count);
          expect(read).toHaveBeenCalledTimes(1);
        } else {
          expect(generate).toHaveBeenCalledTimes(1);
          expect(read).not.toHaveBeenCalled();
          expect(result.status).toBe('failure');
        }
        expect(modelAuthorize).toBeGreaterThanOrEqual(1);
        onInvalidated?.();
        mockDatabase = undefined;
      },
      false,
      true,
    ),
);
