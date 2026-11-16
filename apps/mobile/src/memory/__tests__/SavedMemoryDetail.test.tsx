import { act, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { SavedMemoryDetail } from '../SavedMemoryDetail';
import {
  notifyLocalDataCleared,
  notifyLocalSourceDeleted,
} from '../../storage/localDataClearEvents';
const memory = {
  id: 'synthetic',
  text: 'Synthetic full memory details',
  kind: 'preference' as const,
  createdAt: 1000,
  provenance: {
    sourceIds: ['synthetic-source'],
    reviewState: 'user_confirmed' as const,
  },
};
beforeEach(() => {
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
});
test('renders only the selected ID and full provenance', async () => {
  await render(
    <SavedMemoryDetail
      memoryId={memory.id}
      load={async () => [
        memory,
        { ...memory, id: 'other', text: 'Other private text' },
      ]}
    />,
  );
  expect(screen.getByText(memory.text)).toBeTruthy();
  expect(screen.getByText('사용자 확인 · 출처 1개')).toBeTruthy();
  expect(screen.queryByText('Other private text')).toBeNull();
});
test.each(['background', 'all data', 'source'])(
  'erases detail at %s boundary and rejects a late read',
  async boundary => {
    let resolve!: (rows: (typeof memory)[]) => void;
    await render(
      <SavedMemoryDetail
        memoryId={memory.id}
        load={() =>
          new Promise(done => {
            resolve = done;
          })
        }
      />,
    );
    await act(async () => {
      if (boundary === 'background')
        jest
          .mocked(AppState.addEventListener)
          .mock.calls.at(-1)![1]('background');
      else if (boundary === 'all data') notifyLocalDataCleared();
      else notifyLocalSourceDeleted('local');
    });
    await act(async () => resolve([memory]));
    expect(screen.queryByText(memory.text)).toBeNull();
  },
);
test('missing selected ID never falls back to another memory', async () => {
  await render(
    <SavedMemoryDetail memoryId="deleted" load={async () => [memory]} />,
  );
  expect(screen.getByText('이 기억은 더 이상 볼 수 없어요.')).toBeTruthy();
  expect(screen.queryByText(memory.text)).toBeNull();
});
