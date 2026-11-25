import { act, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { NavigationRouteScrollView } from '../../navigation/NavigationRouteScrollView';
import { SavedMemoryDetail } from '../SavedMemoryDetail';
import {
  notifyLocalDataCleared,
  notifyLocalSourceDeleted,
} from '../../storage/localDataClearEvents';
import { loadUnifiedLocalMemories } from '../unifiedSavedMemories';
import { resumeStatementMemoryAfterRead } from '../resumeStatementMemoryAfterRead';

jest.mock('../unifiedSavedMemories', () => ({
  ...jest.requireActual('../unifiedSavedMemories'),
  loadUnifiedLocalMemories: jest.fn(),
}));
jest.mock('../resumeStatementMemoryAfterRead', () => ({
  resumeStatementMemoryAfterRead: jest.fn(),
}));

jest.mock(
  'react-native/Libraries/Components/RefreshControl/RefreshControl',
  () => {
    const React = jest.requireActual('react');
    const { View } = jest.requireActual('react-native');
    return { default: (props: object) => React.createElement(View, props) };
  },
);
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
  expect(screen.getByText('사용자 확인')).toBeTruthy();
  expect(screen.getByText('연결된 출처 1개')).toBeTruthy();
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

test('only the focused screen reloads when native list and detail coexist', async () => {
  const listLoad = jest.fn().mockResolvedValue([memory]);
  const detailLoad = jest.fn().mockResolvedValue([memory]);
  const { SavedMemoryBrowser } = require('../SavedMemoryBrowser');
  const view = await render(
    <>
      <SavedMemoryBrowser active={false} load={listLoad} />
      <SavedMemoryDetail active memoryId={memory.id} load={detailLoad} />
    </>,
  );
  expect(listLoad).not.toHaveBeenCalled();
  expect(detailLoad).toHaveBeenCalledTimes(1);
  await view.rerender(
    <>
      <SavedMemoryBrowser active load={listLoad} />
      <SavedMemoryDetail
        active={false}
        memoryId={memory.id}
        load={detailLoad}
      />
    </>,
  );
  expect(listLoad).toHaveBeenCalledTimes(1);
  expect(detailLoad).toHaveBeenCalledTimes(1);
});

test('quarantined metadata shows review guidance without rendering saved text', async () => {
  await render(
    <SavedMemoryDetail
      memoryId={memory.id}
      load={async () => [
        { ...memory, unavailableReason: 'unverifiable_parent' },
      ]}
    />,
  );
  expect(
    await screen.findByTestId('saved-memory-parent-unavailable'),
  ).toBeTruthy();
  expect(screen.queryByText(memory.text)).toBeNull();
  expect(screen.queryByTestId('saved-memory-verbatim')).toBeNull();
});

test('pull refresh reads the selected plain memory and discards a result after deletion', async () => {
  const updated = { ...memory, text: 'Updated synthetic memory' };
  let resolve!: (rows: (typeof memory)[]) => void;
  const load = jest
    .fn()
    .mockResolvedValueOnce([memory])
    .mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
  await render(
    <NavigationRouteScrollView pullToRefresh>
      <SavedMemoryDetail memoryId={memory.id} load={load} />
    </NavigationRouteScrollView>,
  );
  const control = () => screen.getByTestId('navigation-route-refresh');
  const pull = () =>
    act(async () => {
      control().props.onRefresh();
    });
  expect(screen.getByText(memory.text)).toBeTruthy();
  await pull();
  expect(load).toHaveBeenCalledTimes(2);
  expect(control().props.refreshing).toBe(true);
  await pull();
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => {
    notifyLocalSourceDeleted('local');
    resolve([updated]);
  });
  expect(control().props.refreshing).toBe(false);
  expect(screen.queryByText(memory.text)).toBeNull();
  expect(screen.queryByText(updated.text)).toBeNull();
});

test('pull replaces the selected saved text without scheduling default-loader maintenance', async () => {
  const updated = { ...memory, text: 'Updated synthetic memory' };
  const load = jest.mocked(loadUnifiedLocalMemories);
  const resume = jest.mocked(resumeStatementMemoryAfterRead);
  load
    .mockReset()
    .mockResolvedValueOnce([memory])
    .mockResolvedValueOnce([updated]);
  resume.mockClear();
  await render(
    <NavigationRouteScrollView pullToRefresh>
      <SavedMemoryDetail memoryId={memory.id} />
    </NavigationRouteScrollView>,
  );
  expect(screen.getByText(memory.text)).toBeTruthy();
  expect(resume).toHaveBeenCalledTimes(1);
  await act(async () => {
    screen.getByTestId('navigation-route-refresh').props.onRefresh();
  });
  expect(screen.getByText(updated.text)).toBeTruthy();
  expect(screen.queryByText(memory.text)).toBeNull();
  expect(resume).toHaveBeenCalledTimes(1);
});

test('long selected memory stays selectable above quieter provenance', async () => {
  const text = 'Synthetic memory line. '.repeat(35);
  await render(
    <SavedMemoryDetail
      memoryId={memory.id}
      load={async () => [{ ...memory, text }]}
    />,
  );
  const sections = screen.getAllByTestId(/^saved-memory-(content|metadata)$/);
  expect(sections.map(section => section.props.testID)).toEqual([
    'saved-memory-content',
    'saved-memory-metadata',
  ]);
  expect(screen.getByTestId('saved-memory-verbatim').props.selectable).toBe(
    true,
  );
  expect(screen.getByText(text.trim())).toBeTruthy();
  expect(screen.getByText('사용자 확인')).toBeTruthy();
});
