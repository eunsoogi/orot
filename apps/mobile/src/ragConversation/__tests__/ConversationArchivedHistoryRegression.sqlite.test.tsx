import { createLocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { AiFeatureLocalData } from '../../aiFeatures/integration/localData';
import type { ColdConversationSourceOwner } from '../../aiFeatures/integration/coldConversationSourceResolvers';
import { createArchivedCitationService } from '../../aiFeatures/integration/archivedCitationService';
import { EvidenceSourceDetailScreen } from '../../aiFeatures/integration/EvidenceSourceDetailScreen';
import { ResolveArchivedCitationContext } from '../useArchivedCitationOpen';
import { useState, useSyncExternalStore } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import {
  setup,
  date,
} from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { ConversationHistory } from '../ConversationHistory';
import { conversationHistoryRecoveryProps } from '../conversationHistoryRecoveryProps';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import {
  createConversationSessions,
  type ConversationSessions,
} from '../conversationSessions';

function Transcript({
  store,
  archive,
  registryFallback,
}: {
  store: ConversationSessions;
  archive: ReturnType<typeof createArchivedCitationService>;
  registryFallback: jest.Mock;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const session = state.sessions.find(row => row.id === state.activeId)!;
  const [selected, setSelected] = useState<{
    reference: EvidenceReference;
    owner?: ColdConversationSourceOwner;
  }>();
  return (
    <ResolveArchivedCitationContext.Provider value={archive.resolve}>
      <ConversationHistory
        {...conversationHistoryRecoveryProps(session, store)}
        messages={session.messages}
        sessionId={session.id}
        pendingMessage={null}
        error={session.error}
        onOpenSource={(reference, owner) => setSelected({ reference, owner })}
        onLinkError={jest.fn()}
      />
      {selected ? (
        <EvidenceSourceDetailScreen
          reference={selected.reference}
          sourceOwner={selected.owner}
          readColdSource={archive.read}
          readSource={registryFallback}
          onBack={() => setSelected(undefined)}
        />
      ) : null}
    </ResolveArchivedCitationContext.Provider>
  );
}

test('reload displays original answers and archived source controls even when outgoing evidence is stale or absent', async () => {
  const f = await setup();
  const strict = jest.fn(async () => {
    throw new Error('Previous answer initiated evidence verification.');
  });
  const registryFallback = jest.fn();
  const repository = createLocalHealthEvidenceRepository(f.db);
  const typedRead = jest.spyOn(repository, 'readRecord');
  const load = jest.fn(
    async () =>
      ({
        openConversationArtifactStorage: async () => f.storage,
        repository,
        loadStaleArtifacts: async () => [
          { kind: 'health_observation', id: f.inside.id },
        ],
      }) as unknown as AiFeatureLocalData,
  );
  const archive = createArchivedCitationService(load);
  const open = () =>
    createConversationSessions({
      retention: createConversationSessionRetention({
        openStorage: async () => f.storage,
        createId: () => 'new',
        now: () => date,
      }),
      restoreSession: strict,
      restoreSessionPage: strict,
      readSavedHistoryDisplay: conversationSavedHistoryDisplayOption(
        async () => ({
          ...f.storage,
          readSessionPresentationMany: (_sessionId, version, ids) =>
            f.display(ids, version),
        }),
      ),
    });
  const stores: ConversationSessions[] = [];
  try {
    const missingId = 'synthetic-missing-source';
    const missingRef = {
      ...f.personal.reference,
      sourceId: missingId,
      evidenceId: missingId,
    };
    const stale = await f.save('stale-evidence', {
      answer: 'Saved answer with stale evidence',
      sources: [f.personal],
      citations: [f.personal.reference],
    });
    // Archive left by an older store with a no-longer-resolvable original ID,
    // but no evidence-removal tombstone or destructive cascade.
    const missing = {
      ...stale,
      id: 'missing-evidence',
      answer: 'Saved answer with missing evidence',
      sources: [
        {
          reference: missingRef,
          records: [{ ...f.personal.records[0]!, id: missingId }],
        },
      ],
      citations: [missingRef],
    };
    await f.db.execute(
      'INSERT INTO conversation_artifacts (id, session_id, created_at, result_json) VALUES (?, ?, ?, ?)',
      [
        missing.id,
        missing.sessionId,
        missing.createdAt,
        JSON.stringify(missing),
      ],
    );
    await f.db.execute(
      "INSERT INTO transcript_artifact_staleness (transcript_id,artifact_kind,artifact_id,superseded_segment_id,current_segment_id,invalidated_at) VALUES ('synthetic-transcript','health_observation',?,'older','updated',?)",
      [f.inside.id, date],
    );
    await expect(f.storage.read(stale.id)).resolves.toBeNull();
    await expect(f.storage.read('missing-evidence')).resolves.toBeNull();
    for (let reload = 0; reload < 2; reload++) {
      const store = open();
      stores.push(store);
      const ui = await render(
        <Transcript
          store={store}
          archive={archive}
          registryFallback={registryFallback}
        />,
      );
      try {
        await act(async () => {
          await store.attachExisting('selected', 0, date);
        });
        expect(ui.getByText('Saved answer with stale evidence')).toBeTruthy();
        expect(ui.getByText('Saved answer with missing evidence')).toBeTruthy();
        expect(load).toHaveBeenCalledTimes(reload * 2);
        expect(typedRead).toHaveBeenCalledTimes(reload);
        const chips = ui.queryAllByTestId(/-citation-0$/);
        expect(chips).toHaveLength(2);
        await fireEvent.press(chips[0]!);
        expect(
          await ui.findByTestId('ai-feature-source-unavailable'),
        ).toBeTruthy();
        expect(ui.getByText('Saved answer with stale evidence')).toBeTruthy();
        expect(ui.getByText('Saved answer with missing evidence')).toBeTruthy();
        expect(registryFallback).not.toHaveBeenCalled();
        expect(strict).not.toHaveBeenCalled();
      } finally {
        await ui.unmount();
      }
    }
    expect(f.sql.length).toBeGreaterThan(0);
    await f.db.execute(
      "DELETE FROM conversation_artifacts WHERE id='missing-evidence'",
    );
    expect((await f.display(['missing-evidence']))[0]).toBeNull();
    await f.storage.hideSession('selected', 0);
    await expect(f.display([stale.id])).rejects.toThrow('unavailable');
  } finally {
    stores.forEach(store => store.dispose());
    f.close();
  }
}, 20000);
