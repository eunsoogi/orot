import { act, fireEvent, screen } from '@testing-library/react-native';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import {
  createGeneratedReportReader,
  openGeneratedReportReader,
} from '../../generatedReports/readers';
import type { AiFeatureLocalData } from '../../aiFeatures/integration/localData';
import { possibilityReportTemplate } from '../../ragConversation/conversationReportTemplate';
import { setup } from '../../storage/testSupport/conversationHistoryDisplayFixture';
import type {
  ConversationExecutionAdapter,
  ConversationExecutionEvent,
} from '../../ragConversation/conversationExecutionLease';
import { renderRecordsRouteTest } from './renderRecordsRouteTest';

export const first = 'https://example.org/first';
export const second = 'https://example.org/second';
export const article = 'https://europepmc.org/article/MED/SYNTHETIC-PAPER';

export async function openReport() {
  const f = await setup();
  const template = possibilityReportTemplate();
  const publication = {
    ...f.external.reference,
    sourceId: 'europe-pmc',
    evidenceId: 'MED:SYNTHETIC-PAPER',
    locator: {
      provider: 'Europe PMC',
      source: 'MED',
      recordId: 'SYNTHETIC-PAPER',
      title: 'Synthetic publication',
      originalUrl: article,
    },
    reviewState: 'unknown' as const,
  };
  const mismatched = {
    ...publication,
    evidenceId: 'MED:ANOTHER-PAPER',
    locator: { ...publication.locator, title: 'Mismatched publication' },
  };
  const malformedWeb = {
    ...f.external.reference,
    sourceId: 'public-web',
    evidenceId: 'malformed-web',
    locator: {
      kind: 'public_web_search',
      title: 'Malformed external snapshot',
      sources: [{ title: 'Bad link', url: 'file:///sample' }],
    },
  };
  const web = {
    ...f.external.reference,
    sourceId: 'public-web',
    evidenceId: 'synthetic-web',
    locator: {
      kind: 'public_web_search',
      sources: [
        { title: 'First original', url: first },
        { title: 'Second original', url: second },
      ],
    },
  };
  const references = [web, publication, mismatched, malformedWeb];
  await f.save('public-report', {
    entryIntent: 'possibilities',
    answer: [
      `# ${template.title}`,
      ...template.sections.map(
        (section, i) => `## ${section}\nSynthetic paragraph ${i + 1}.`,
      ),
    ].join('\n'),
    sources: references.map(reference => ({ ...f.external, reference })),
    citations: references,
  });
  const local = jest.fn(async () => ({}) as AiFeatureLocalData);
  const reader = createGeneratedReportReader(f.db, {
    data: local,
    records: async () => f.repository,
  });
  const resolve = jest.spyOn(reader.archivedSources!, 'resolve');
  const read = jest.spyOn(reader, 'read');
  jest.mocked(openGeneratedReportReader).mockResolvedValue(reader);
  const browser = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const nav = await renderRecordsRouteTest();
  await fireEvent.press(screen.getByTestId('records-open-generated-reports'));
  await fireEvent.press(
    await screen.findByTestId('generated-report-conversation:public-report'),
  );
  expect(await screen.findByText('Synthetic paragraph 1.')).toBeVisible();
  return { f, nav, local, resolve, browser, read };
}

export function installReportAppState() {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((event, listener) => {
      if (event === 'change') listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
  return (state: AppStateStatus) =>
    act(() => {
      AppState.currentState = state;
      listeners.forEach(listener => listener(state));
    });
}

export function reportNativeWitness() {
  let available = true;
  const listeners = new Set<(event: ConversationExecutionEvent) => void>();
  const protectedDataAvailable = jest.fn(async () => available);
  const adapter: ConversationExecutionAdapter = {
    bridgeAvailable: true,
    currentPhase: () =>
      AppState.currentState === 'active' ? 'active' : 'inactive',
    begin: async () => false,
    end: () => {},
    isActive: async () => false,
    protectedDataAvailable,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    adapter,
    protectedDataAvailable,
    set(next: boolean, emit = false) {
      available = next;
      if (emit)
        listeners.forEach(listener =>
          listener({ kind: 'protectedData', available }),
        );
    },
  };
}
