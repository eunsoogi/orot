import {
  conversationToolLabel,
  conversationToolLabelKeys,
} from '../conversationToolLabels';

test.each(Object.keys(conversationToolLabelKeys))(
  'localizes registered tool %s',
  id => {
    expect(conversationToolLabel(id)).toMatch(/[가-힣]/u);
    expect(conversationToolLabel(id)).not.toBe('도구 활동');
  },
);
test('uses a generic label for unrecognized tools without inventing their function', () => {
  expect(conversationToolLabel('unknown-provider-tool')).toBe('도구 활동');
  expect(conversationToolLabel('local-health-context')).toBe('건강 기록 확인');
});
