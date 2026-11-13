import { replyPreview } from '../replyPreview';

test('renders readable reply text without exposing link destinations or splitting emoji', () => {
  expect(
    replyPreview(
      '## 검사 결과\n[자세히](https://example.com/private) **정상**\n```swift\nlet 수치 = 1\n```',
    ),
  ).toBe('검사 결과 자세히 정상 let 수치 = 1');
  expect(replyPreview('가'.repeat(119) + '👨‍👩‍👧‍👦끝')).toBe('가'.repeat(119) + '…');
});

test('keeps actual health-like text and suppresses whitespace', () => {
  expect(replyPreview('혈압은 120/80 mmHg입니다.')).toBe(
    '혈압은 120/80 mmHg입니다.',
  );
  expect(replyPreview('   \n   ')).toBe('');
});
