import {
  chosen,
  other,
  withRecordings,
} from '../testSupport/selectedRecordingSqliteFixture';
import { createConversationRecordingDraft } from '../../../ragConversation/conversationRecordingDraft';
import { guardConversationHistoryProvider } from '../conversationHistoryProviderGuard';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createSelectedRecordingTranscriptTool } from '../../../conversationTools/selectedRecordingTranscriptTool';

function request() {
  return {
    operationRunId: 'test-run',
    operationKey: 'test-search',
    input: { query: 'synthetic transcript' },
    resultLimit: 6,
    maxPayloadBytes: 4096,
    allowedScope: { sourceKinds: ['personal_record' as const] },
    signal: new AbortController().signal,
  };
}

it('reads only the selected saved recording current text and produces revision-bound citations', () =>
  withRecordings(async (data, correct) => {
    const registry = new LocalEvidenceReferenceRegistry();
    const tool = createSelectedRecordingTranscriptTool(data, registry, {
      sourceId: chosen,
      isCurrent: () => true,
    });
    const result = await tool.search(request());
    expect(result).toHaveProperty('items');
    if (!('items' in result))
      throw new Error('Expected selected recording result');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.content).toContain('selected revision');
    expect(JSON.stringify(result)).not.toMatch(/outdated|foreign|audio-source/);
    expect(
      await registry.revalidateEvidence(result.items, request().signal),
    ).toBe(true);
    await correct();
    expect(
      await registry.revalidateEvidence(result.items, request().signal),
    ).toBe(false);
  }));

it('rejects invented model source, foreign scope and revoked owner before protected reads', () =>
  withRecordings(async data => {
    const read = jest.spyOn(data, 'readCandidates');
    let current = true;
    const tool = createSelectedRecordingTranscriptTool(
      data,
      new LocalEvidenceReferenceRegistry(),
      { sourceId: chosen, isCurrent: () => current },
    );
    expect(
      tool.parseInput({ query: 'synthetic', sourceId: other }),
    ).toBeUndefined();
    const scope = {
      sourceKinds: ['personal_record' as const],
      sourceIds: [other],
    };
    const denied = await tool.search({ ...request(), allowedScope: scope });
    expect(denied).toMatchObject({ items: [] });
    expect(read).not.toHaveBeenCalled();
    current = false;
    await expect(tool.search(request())).rejects.toThrow(
      'Selected recording expired',
    );
    expect(read).not.toHaveBeenCalled();
  }));

it('cannot release a result after selected recording ownership is revoked while reading', () =>
  withRecordings(async data => {
    let current = true;
    const load = data.readCandidates;
    const revoked = {
      ...data,
      async readCandidates(...args: Parameters<typeof load>) {
        const rows = await load(...args);
        current = false;
        return rows;
      },
    };
    const tool = createSelectedRecordingTranscriptTool(
      revoked,
      new LocalEvidenceReferenceRegistry(),
      { sourceId: chosen, isCurrent: () => current },
    );
    await expect(tool.search(request())).rejects.toThrow(
      'Selected recording expired',
    );
  }));

it('keeps the accepted composer ticket scoped across real local retrieval and rechecks it before outgoing dispatch', () =>
  withRecordings(async data => {
    const draft = createConversationRecordingDraft(jest.fn());
    expect(draft.select({ key: chosen })).toBe(true);
    let appOwnsTurn = true;
    const ticket = draft.claim(() => appOwnsTurn);
    if (!ticket || !ticket.admit()) throw new Error('expected current ticket');
    expect(draft.get()).toBeNull();
    const registry = new LocalEvidenceReferenceRegistry();
    const tool = createSelectedRecordingTranscriptTool(data, registry, ticket);
    const result = await tool.search(request());
    expect(JSON.stringify(result)).toContain('selected revision');
    expect(JSON.stringify(result)).not.toMatch(/foreign|outdated|audio-source/);

    const generate = jest.fn();
    const provider = guardConversationHistoryProvider(
      { generate } as unknown as LanguageModelProvider,
      ticket.isCurrent,
    );
    appOwnsTurn = false;
    await provider.generate(
      {} as Parameters<LanguageModelProvider['generate']>[0],
    );
    expect(generate).not.toHaveBeenCalled();
    expect(draft.claim(() => true)).toBeUndefined();
    ticket.release();
    expect(draft.claim(() => true)).toBeUndefined();
  }));

it('does not release transcript text after silent protected-data loss during the selected read', () =>
  withRecordings(async data => {
    let readable = true;
    const original = data.readCandidates.bind(data);
    jest.spyOn(data, 'readCandidates').mockImplementation(async (...args) => {
      const snapshot = await original(...args);
      readable = false;
      return snapshot;
    });
    const tool = createSelectedRecordingTranscriptTool(
      data,
      new LocalEvidenceReferenceRegistry(),
      { sourceId: chosen, isCurrent: () => true },
      async () => readable,
    );
    await expect(tool.search(request())).rejects.toThrow(
      'Selected recording expired',
    );
  }));
