import { historicalMemoryBoundaryCases } from '../testSupport/historicalMemoryBoundaryCases';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { createAgentMemory, listSavedMemories } from '@orot/agent-memory';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { loadSavedLocalMemories } from '../savedLocalMemories';
import { SavedMemoryDetail } from '../SavedMemoryDetail';
import { resumeStatementMemoryAfterRead } from '../resumeStatementMemoryAfterRead';
import {
  checkProtection,
  historicalMemoryFixture,
  nativeListeners,
  resetHistoricalProtectionMock,
  invalidateHistoricalMemoryFixture,
} from '../testSupport/historicalMemoryFixture';
import { createNavigationController } from '../../navigation/navigationController';
// Load actual Metro lazy modules in Jest, outside the app graph.
function mockCompileHistoricalMemoryModule(path: string) {
  const { readFileSync } = require('node:fs');
  const { dirname, resolve } = require('node:path');
  const { runInNewContext } = require('node:vm');
  const { transformSync } = require('@babel/core');
  const resolveModule = (
    require as NodeRequire & {
      resolve(name: string, options?: { paths: string[] }): string;
    }
  ).resolve;
  const filename = resolveModule(path);
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
  runInNewContext(transformed!.code!, {
    module,
    exports: module.exports,
    setTimeout,
    clearTimeout,
    require: (name: string) =>
      require(name.startsWith('.') ? resolve(dirname(filename), name) : name),
  });
  return module.exports;
}
jest.mock('../useSavedMemories', () =>
  mockCompileHistoricalMemoryModule('../useSavedMemories'),
);
jest.mock('../unifiedSavedMemories', () =>
  mockCompileHistoricalMemoryModule('../unifiedSavedMemories'),
);
jest.mock('../savedLocalMemories', () =>
  mockCompileHistoricalMemoryModule('../savedLocalMemories'),
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
    listSavedConversationAnswers: async () => [],
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
beforeEach(resetHistoricalProtectionMock);
async function verifyHistoricalReview(laterReview: boolean) {
  const file = await historicalMemoryFixture(laterReview);
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
      expect(createAgentMemory).not.toHaveBeenCalled();
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
}
test.each([false, true])(
  'reads exact historical review (replacement: %s)',
  verifyHistoricalReview,
);

test.each(historicalMemoryBoundaryCases)(
  'never discloses historical prose for %s',
  async boundary => {
    const file = await historicalMemoryFixture(
      boundary.startsWith('replacement '),
    );
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
        expect(createAgentMemory).not.toHaveBeenCalled();
      } finally {
        await view.unmount();
      }
    } finally {
      file.close();
    }
  },
);

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
