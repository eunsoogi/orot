import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { listSavedMemories } from '@orot/agent-memory';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { loadSavedLocalMemories } from '../savedLocalMemories';
import { SavedMemoryDetail } from '../SavedMemoryDetail';
import { resumeStatementMemoryAfterRead } from '../resumeStatementMemoryAfterRead';
import {
  historicalMemoryFixture,
  invalidateHistoricalMemoryFixture,
} from '../testSupport/historicalMemoryFixture';
import { createNavigationController } from '../../navigation/navigationController';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import type { ConversationExecutionEvent } from '../../ragConversation/conversationExecutionLease';

jest.mock('../useSavedMemories', () =>
  require('../testSupport/historicalMemoryLazyModule').compileHistoricalMemoryModule(
    '../useSavedMemories',
  ),
);
jest.mock('../unifiedSavedMemories', () =>
  require('../testSupport/historicalMemoryLazyModule').compileHistoricalMemoryModule(
    '../unifiedSavedMemories',
  ),
);
jest.mock('../savedLocalMemories', () =>
  require('../testSupport/historicalMemoryLazyModule').compileHistoricalMemoryModule(
    '../savedLocalMemories',
  ),
);
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../manualHistory/localRepository', () => ({
  openLocalManualHistoryRepository: async () => ({ list: async () => [] }),
}));
jest.mock('../openSavedGeneratedReportReferences', () => ({
  openSavedGeneratedReportReferences: async () => ({
    listSavedGeneratedReportReferences: async () => [],
  }),
}));
jest.mock('../resumeStatementMemoryAfterRead', () => ({
  resumeStatementMemoryAfterRead: jest.fn(),
}));
jest.mock('@orot/agent-memory', () => ({
  ...jest.requireActual('@orot/agent-memory'),
  createAgentMemory: jest.fn(() => {
    throw new Error('Do not open an AI memory engine from Memory Detail.');
  }),
}));

jest.mock('../../ragConversation/conversationExecutionNative');

const nativeListeners = new Set<(event: ConversationExecutionEvent) => void>();
const checkProtection = jest.fn<Promise<boolean>, []>();
beforeEach(() => {
  jest.clearAllMocks();
  checkProtection.mockReset().mockResolvedValue(true);
  nativeListeners.clear();
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    begin: jest.fn(),
    end: jest.fn(),
    isActive: jest.fn(),
    protectedDataAvailable: checkProtection,
    subscribe(listener) {
      nativeListeners.add(listener);
      return () => {
        nativeListeners.delete(listener);
      };
    },
  });
});

test('current owner reads the exact committed review despite missing historical evidence attestation', async () => {
  const file = await historicalMemoryFixture();
  const text = file.retained.text;
  try {
    expect(await listSavedMemories(file.storage)).toEqual([]);
    expect(await loadSavedLocalMemories()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ text })]),
    );
    const view = await render(<SavedMemoryDetail memoryId={file.id} />);
    try {
      expect(
        (await screen.findByTestId('saved-memory-verbatim')).props.children,
      ).toBe(text);
      expect(
        screen.getByText(
          '지금 확인할 수 없는 출처가 있어 저장된 내용만 표시해요. AI는 이 기억을 재사용하지 않아요.',
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/연결된 출처/)).toBeNull();
      expect(screen.queryByRole('link')).toBeNull();
      expect(
        screen.getByTestId('saved-memory-verbatim').props.selectable,
      ).toBeFalsy();
      expect(checkProtection).toHaveBeenCalledTimes(2);
      expect(resumeStatementMemoryAfterRead).not.toHaveBeenCalled();
      expect(
        jest.requireMock('@orot/agent-memory').createAgentMemory,
      ).not.toHaveBeenCalled();
      expect(await listSavedMemories(file.storage)).toEqual([]);
      await expect(file.requireCurrentEvidence()).rejects.toThrow('parent');
      expect(
        (await file.db.execute('SELECT record_json FROM agent_memory_records'))
          .rows,
      ).toEqual([{ record_json: file.raw }]);

      await act(async () => {
        await file.db.execute(
          'INSERT INTO source_deletion_tombstones(source_id) VALUES (?)',
          [file.sourceId],
        );
        notifyLocalSourceDeleted('local', new Set([file.sourceId]));
      });
      expect(screen.queryByTestId('saved-memory-verbatim')).toBeNull();
      expect(
        screen.getByText('기록이 변경되어 기억을 다시 불러와야 해요.'),
      ).toBeTruthy();
    } finally {
      await view.unmount();
    }
  } finally {
    file.close();
  }
});

test.each([
  'explicit record tombstone',
  'explicit source tombstone',
  'physical deletion',
  'other namespace',
  'malformed provenance',
  'forged row identity',
  'forged text',
  'mismatched appointment',
  'non-owner review',
  'orphan source identity',
  'locked open',
  'warm connection locked',
  'locked after read',
])('never discloses historical prose for %s', async boundary => {
  const file = await historicalMemoryFixture();
  try {
    if (boundary === 'locked open') {
      jest
        .mocked(openLocalAgentMemoryDatabase)
        .mockRejectedValue(new Error('locked'));
    } else if (boundary === 'warm connection locked') {
      checkProtection.mockResolvedValue(false);
    } else if (boundary === 'locked after read') {
      checkProtection.mockResolvedValueOnce(true).mockResolvedValue(false);
    } else {
      await invalidateHistoricalMemoryFixture(file, boundary);
    }
    const view = await render(<SavedMemoryDetail memoryId={file.id} />);
    try {
      expect(openLocalAgentMemoryDatabase).toHaveBeenCalled();
      if (boundary === 'locked open') {
        expect(
          await screen.findByText(
            '기억을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
          ),
        ).toBeTruthy();
      } else {
        expect(
          await screen.findByText(
            /이 기억의 저장된 내용을 표시할 수 없어요|이 기억은 더 이상 볼 수 없어요/,
          ),
        ).toBeTruthy();
      }
      expect(screen.queryByTestId('saved-memory-verbatim')).toBeNull();
      expect(
        jest.requireMock('@orot/agent-memory').createAgentMemory,
      ).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  } finally {
    file.close();
  }
});

test('native protected-data loss hides an already-open historical snapshot with AppState still active', async () => {
  const file = await historicalMemoryFixture();
  try {
    const view = await render(<SavedMemoryDetail memoryId={file.id} />);
    try {
      expect(await screen.findByTestId('saved-memory-verbatim')).toBeTruthy();
      await act(async () => {
        nativeListeners.forEach(listener =>
          listener({ kind: 'protectedData', available: false }),
        );
      });
      expect(AppState.currentState).toBe('active');
      expect(screen.queryByTestId('saved-memory-verbatim')).toBeNull();
    } finally {
      await view.unmount();
    }
  } finally {
    file.close();
  }
});

test('controller Back revokes a selected historical body before focus changes', async () => {
  const file = await historicalMemoryFixture();
  const controller = createNavigationController<'root' | 'detail'>('root');
  const route = controller.push('detail')!;
  controller.registerLeaveGuard(route.key, async () => true);
  const ownership = {
    isCurrent() {
      const snapshot = controller.getSnapshot();
      return (
        !snapshot.isTransitioning && snapshot.currentRoute.key === route.key
      );
    },
    subscribe: controller.subscribe,
  };
  let release!: (available: boolean) => void;
  checkProtection.mockResolvedValueOnce(true).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        release = resolve;
      }),
  );
  try {
    const view = await render(
      <SavedMemoryDetail memoryId={file.id} ownership={ownership} />,
    );
    try {
      await waitFor(() => expect(checkProtection).toHaveBeenCalledTimes(2));
      await act(async () => {
        expect(await controller.requestBack()).toBe(true);
        release(true);
      });
      expect(controller.getSnapshot().currentRoute.name).toBe('root');
      expect(screen.queryByTestId('saved-memory-verbatim')).toBeNull();
      expect(resumeStatementMemoryAfterRead).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  } finally {
    file.close();
  }
});
