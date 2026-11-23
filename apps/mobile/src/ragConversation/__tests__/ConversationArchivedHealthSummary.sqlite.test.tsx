import { createArchivedCitationService } from '../../aiFeatures/integration/archivedCitationService';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';
import { ResolveArchivedCitationContext } from '../useArchivedCitationOpen';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { setup } from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { window } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { ConversationMessage } from '../ConversationMessage';
import { savedHistoryTranscript } from '../conversationSavedHistoryDisplay';

test('the archived summary uses the saved canonical card from one owned presentation lookup', async () => {
  const f = await setup();
  try {
    await f.summaryStorage.append(f.saved);
    const info = { summaryId: f.saved.id, window };
    await f.save('rich-health-summary', {
      providerId: f.saved.providerId,
      modelId: f.saved.modelId,
      healthSummary: info,
    });
    await f.save('wrong-provider-health-summary', {
      providerId: 'different-provider',
      modelId: f.saved.modelId,
      healthSummary: info,
    });
    const sql: string[] = [];
    const transaction = f.db.transaction.bind(f.db);
    const watch = jest.spyOn(f.db, 'transaction').mockImplementation(work =>
      transaction(tx =>
        work({
          ...tx,
          execute(query, parameters) {
            sql.push(query);
            if (
              /health_observations|source_records|transcript_artifact_staleness|health_context_generation/i.test(
                query.replaceAll(
                  'SELECT deletions FROM health_context_generation WHERE singleton = 1',
                  '',
                ),
              )
            )
              throw new Error('Archived HealthSummaryCard touched evidence.');
            return tx.execute(query, parameters);
          },
        }),
      ),
    );
    const read = conversationSavedHistoryDisplayOption(async () => f.storage);
    const page = await read('selected', 0, new AbortController().signal);
    const retained = page.rows.find(row => row.id === 'rich-health-summary');
    const wrongProvider = page.rows.find(
      row => row.id === 'wrong-provider-health-summary',
    );
    expect(retained).toMatchObject({
      kind: 'answer',
      healthSummary: { reference: info },
    });
    expect(wrongProvider).not.toHaveProperty('healthSummary');
    expect(
      sql.filter(query => query.includes('FROM symptom_summary_runs r')),
    ).toHaveLength(1);
    const messages = savedHistoryTranscript(
      [{ row: retained!, questionId: -1, answerId: -2 }],
      [],
    );
    const answer = messages[1]!;
    expect(answer.retainedTurnId).toBeUndefined();
    expect(
      answer.healthSummary?.analysis.hypotheses[0]?.supportingEvidence,
    ).toEqual([]);
    const onOpenSource = jest.fn();
    const onLinkError = jest.fn();
    const signal = new AbortController().signal;
    const reloadPeriod = jest.fn(f.read);
    const service = createArchivedCitationService(async () => ({
      ...localData([]).data,
      openConversationArtifactStorage: async () => f.storage,
      readHealthContext: reloadPeriod,
    }));
    const resolve = jest.fn(service.resolve);
    const ui = await render(
      <ResolveArchivedCitationContext.Provider value={resolve}>
        <ConversationMessage
          message={answer}
          onOpenSource={onOpenSource}
          onLinkError={onLinkError}
        />
      </ResolveArchivedCitationContext.Provider>,
    );
    expect(ui.getByTestId('health-summary-card')).toBeTruthy();
    expect(ui.getByTestId('health-summary-period')).toBeTruthy();
    expect(ui.getByText(f.saved.analysis.hypotheses[0]!.summary)).toBeTruthy();
    expect(onOpenSource).not.toHaveBeenCalled();
    expect(reloadPeriod).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(answer.healthSummary?.archivedSectionCitations?.[0]).toHaveLength(1);
    const chip = ui.getByTestId(
      'rag-conversation-message--2-summary-section-0-citation-0',
    );
    watch.mockRestore();
    await fireEvent.press(chip);
    await waitFor(() => expect(onOpenSource).toHaveBeenCalledTimes(1));
    const [reference, owner] = onOpenSource.mock.calls[0]!;
    expect(owner.archiveCitation.summary.id).toBe(f.saved.id);
    expect(await service.read(owner, reference, signal)).toMatchObject({
      status: 'available',
    });
    expect(
      await service.resolve(
        {
          ...answer.archivedCitationTarget!,
          summary: {
            id: 'another-summary',
            revision: owner.archiveCitation.summary.revision,
          },
        },
        0,
        signal,
      ),
    ).toBeUndefined();
    const replacedOwner = {
      ...owner,
      archiveCitation: {
        ...owner.archiveCitation,
        summary: {
          ...owner.archiveCitation.summary,
          revision: 'different-revision',
        },
      },
    };
    expect(await service.read(replacedOwner, reference, signal)).toEqual({
      status: 'unavailable',
    });
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'new-synthetic-observation-in-same-period',
    });
    const stale = await read('selected', 0, signal);
    expect(
      stale.rows.find(row => row.id === 'rich-health-summary'),
    ).toMatchObject({
      healthSummary: {
        analysis: {
          hypotheses: [{ summary: f.saved.analysis.hypotheses[0]!.summary }],
          savedSummary: { sourceChanged: true },
        },
      },
    });
    expect(await service.read(owner, reference, signal)).toEqual({
      status: 'unavailable',
    });
    await f.db.execute('DELETE FROM health_observations WHERE id = ?', [
      f.inside.id,
    ]);
    expect(await service.read(owner, reference, signal)).toEqual({
      status: 'unavailable',
    });
    await fireEvent.press(chip);
    await waitFor(() => expect(onLinkError).toHaveBeenCalledTimes(1));
    expect(onOpenSource).toHaveBeenCalledTimes(1);
    await ui.unmount();
    const followup = await read('selected', 0, new AbortController().signal);
    expect(
      followup.rows.find(row => row.id === 'rich-health-summary'),
    ).not.toHaveProperty('healthSummary');
  } finally {
    f.close();
  }
});
