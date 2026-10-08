import { navigationText } from '../navigation';

describe('navigation Korean terms', () => {
  it('uses distinct visible labels and accessible names for back, cancel, close, and home', () => {
    const visibleLabels = [
      navigationText.back.label,
      navigationText.cancel.label,
      navigationText.close.label,
      navigationText.home.label,
    ];
    const accessibleNames = [
      navigationText.back.accessibilityLabel,
      navigationText.cancel.accessibilityLabel,
      navigationText.close.accessibilityLabel,
      navigationText.home.accessibilityLabel,
    ];

    expect(new Set(visibleLabels).size).toBe(4);
    expect(new Set(accessibleNames).size).toBe(4);
  });

  it('describes close as closing the current screen', () => {
    expect(navigationText.close.accessibilityLabel).toBe('현재 화면 닫기');
  });

  it('explains what leaving discards and what stopping a recording does', () => {
    expect(navigationText.leaveUnsaved.message).toContain('저장되지 않은');
    expect(navigationText.leaveRecording.confirm).toContain('녹음');
    expect(navigationText.leaveRecording.cancel).toBe('계속 녹음');
  });
});
