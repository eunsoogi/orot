import { createRecordRepository, type SqlDatabase } from '@orot/storage';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { ConversationArtifact } from '../../storage/conversationArtifactTypes';
import {
  isCurrentLocalAgentMemoryDatabase,
  openLocalAgentMemoryDatabase,
} from '../../storage/secureDatabase';
import { GeneratedReportDetailDestination } from '../GeneratedReportDetailDestination';
import { openGeneratedReportReader } from '../readers';

type Native = NonNullable<ReturnType<typeof conversationExecutionNative>>;
type Event = Parameters<Parameters<Native['subscribe']>[0]>[0];

export async function expectSelectedRecordsPossibility(
  database: SqlDatabase,
  storage: ReturnType<typeof createConversationArtifactStorage>,
  saved: ConversationArtifact,
  syntheticSourceId: string,
  visibleBody: string,
) {
  const now = () => '2026-10-05T00:00:01.000Z';
  const legacy = {
    ...saved,
    id: 'legacy-identical-narrative',
    createdAt: now(),
    possibilityOriginal: undefined,
  };
  await storage.startRequest({
    id: legacy.id,
    sessionId: legacy.sessionId,
    sessionVersion: 0,
    question: legacy.question,
    createdAt: legacy.createdAt,
  });
  await storage.append(legacy);

  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
  jest
    .mocked(isCurrentLocalAgentMemoryDatabase)
    .mockImplementation(candidate => candidate === database);
  const native = jest.mocked(conversationExecutionNative);
  const probe = jest.fn().mockResolvedValue(true);
  const listeners = new Set<(event: Event) => void>();
  native.mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    protectedDataAvailable: probe,
    subscribe(listener: (event: Event) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as Native);

  const reader = await openGeneratedReportReader();
  const catalog = await reader.list();
  const row = catalog.find(item => item.key === `conversation:${saved.id}`);
  const old = catalog.find(item => item.key === `conversation:${legacy.id}`);
  if (!row || !old) throw new Error('Selected catalog rows are missing.');
  expect(JSON.stringify(catalog)).not.toContain(visibleBody);

  const historical = await render(
    <GeneratedReportDetailDestination row={old} active />,
  );
  try {
    expect(await screen.findByText(visibleBody)).toBeTruthy();
    expect(probe).not.toHaveBeenCalled();
  } finally {
    await historical.unmount();
  }

  let permitFirst!: (allowed: boolean) => void;
  const first = new Promise<boolean>(resolve => {
    permitFirst = resolve;
  });
  probe.mockReturnValueOnce(first);
  const view = await render(
    <GeneratedReportDetailDestination row={row} active />,
  );
  try {
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(visibleBody)).toBeNull();
    await act(async () => {
      permitFirst(true);
      await first;
    });
    expect(await screen.findByText(visibleBody)).toBeTruthy();
    expect(
      screen.queryByTestId('generated-report-bookmark-original'),
    ).toBeNull();
    await act(() => {
      for (const available of [false, true])
        for (const listener of [...listeners])
          listener({ kind: 'protectedData', available });
    });
    expect(screen.queryByText(visibleBody)).toBeNull();
  } finally {
    permitFirst(false);
    await view.unmount();
  }

  probe.mockClear();
  let allowLate!: (allowed: boolean) => void;
  const late = new Promise<boolean>(resolve => {
    allowLate = resolve;
  });
  probe
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockReturnValueOnce(late);
  const heldView = await render(
    <GeneratedReportDetailDestination row={row} active />,
  );
  try {
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(3));
    await act(async () => {
      expect(
        await createRecordRepository(database).delete(
          'health_observation',
          syntheticSourceId,
        ),
      ).toBe(true);
      allowLate(true);
      await late;
    });
    expect(screen.queryByText(visibleBody)).toBeNull();
  } finally {
    allowLate(false);
    await heldView.unmount();
  }
}
