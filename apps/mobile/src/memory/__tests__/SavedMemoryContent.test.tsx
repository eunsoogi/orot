import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SavedMemoryContent } from '../SavedMemoryContent';
import type { AgentSavedMemory } from '../unifiedSavedMemories';

const text = '합성 기억 원문. 불확실한 내용은 그대로 유지해요.\n'.repeat(40);
const memory: AgentSavedMemory = {
  id: 'synthetic',
  text,
  kind: 'reviewed_interaction',
  createdAt: 1000,
  provenance: {
    sourceIds: ['source-a', 'source-b'],
    reviewState: 'human_reviewed',
  },
};

test('groups exact selectable text and metadata without truncating or shrinking the body', async () => {
  await render(<SavedMemoryContent memory={memory} />);
  expect(screen.getByRole('header', { name: '기억 내용' })).toBeTruthy();
  expect(screen.getByRole('header', { name: '저장 정보' })).toBeTruthy();
  const body = screen.getByTestId('saved-memory-verbatim');
  expect(body.props.children).toBe(text);
  expect(body.props.selectable).toBe(true);
  expect(body.props.numberOfLines).toBeUndefined();
  expect(StyleSheet.flatten(body.props.style)).toMatchObject({
    fontSize: 16,
    lineHeight: 26,
  });
  expect(screen.getByText('연결된 출처 2개')).toBeTruthy();
  expect(screen.queryByText('source-a')).toBeNull();
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});

test.each([
  ['user_stated', '사용자가 말한 내용'],
  ['user_confirmed', '사용자 확인'],
  ['human_reviewed', '사람이 검토'],
] as const)(
  'preserves the %s trust label without upgrading its meaning',
  async (reviewState, label) => {
    await render(
      <SavedMemoryContent
        memory={{
          ...memory,
          provenance: { ...memory.provenance, reviewState },
        }}
      />,
    );
    expect(screen.getByText(label)).toBeTruthy();
    if (reviewState === 'user_stated')
      expect(screen.queryByText('사람이 검토')).toBeNull();
  },
);
