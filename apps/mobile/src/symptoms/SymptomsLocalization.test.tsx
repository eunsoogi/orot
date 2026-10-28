import { fireEvent, render, screen } from '@testing-library/react-native';
import SymptomsScreen from './SymptomsScreen';
import { SymptomEntrySchema } from '@orot/storage';
import type { SymptomEntry } from '@orot/storage';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const NativeDateTimeFormat = Intl.DateTimeFormat;

function useDeviceLocale(locale: string) {
  jest
    .spyOn(Intl, 'DateTimeFormat')
    .mockImplementation(
      ((locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) =>
        new NativeDateTimeFormat(
          locales ?? locale,
          options,
        )) as typeof Intl.DateTimeFormat,
    );
}

function symptom(
  id: string,
  status: SymptomEntry['status'],
  severity?: number,
): SymptomEntry {
  const recordedAt = '2026-05-01T12:00:00Z';
  return SymptomEntrySchema.parse({
    id,
    effectiveAt: '2026-04-20T08:30:00Z',
    recordedAt,
    ingestedAt: recordedAt,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    description: '직접 작성한 증상 설명',
    bodySite: '왼쪽 손',
    ...(severity === undefined ? {} : { severity }),
    status,
    ...(status === 'resolved' ? { resolvedAt: '2026-04-20T09:30:00Z' } : {}),
  });
}

function renderScreen(
  overrides: Partial<React.ComponentProps<typeof SymptomsScreen>> = {},
) {
  return render(
    <SymptomsScreen
      entries={[]}
      onBack={jest.fn()}
      onRetry={jest.fn()}
      onFilterChange={jest.fn()}
      onCreate={jest.fn()}
      onUpdate={jest.fn()}
      onResolve={jest.fn()}
      {...overrides}
    />,
  );
}

afterEach(() => jest.restoreAllMocks());

describe.each(['en-US', 'ko-KR'])(
  'symptom journal copy for %s device locale',
  locale => {
    it('keeps app copy Korean and preserves user text, status meaning, and zero', async () => {
      useDeviceLocale(locale);
      const active = symptom('active-entry', 'active', 0);
      const resolved = symptom('resolved-entry', 'resolved');
      const missingSeverity = symptom('missing-severity-entry', 'active');
      await renderScreen({ entries: [active, resolved, missingSeverity] });

      expect(screen.getByTestId('symptoms-title')).toHaveTextContent(
        '증상 일지',
      );
      expect(screen.getByText('상태로 필터링')).toBeTruthy();
      expect(screen.getByText('시작 시각으로 필터링')).toBeTruthy();
      expect(
        screen.getByTestId('symptom-active-entry-status'),
      ).toHaveTextContent('계속되고 있어요');
      expect(
        screen.getByTestId('symptom-resolved-entry-status'),
      ).toHaveTextContent('나아졌어요');
      expect(
        screen.getByTestId('symptom-active-entry-severity'),
      ).toHaveTextContent('내가 느낀 불편 정도: 0/10');
      expect(
        screen.getByTestId('symptom-active-entry-description'),
      ).toHaveTextContent('직접 작성한 증상 설명');
      const onsetLabel = screen.getByTestId('symptom-active-entry-onset').props
        .children as string;
      expect(onsetLabel).toContain('현지 시각');
      expect(onsetLabel).not.toContain('2026-04-20T08:30:00Z');
      expect(
        screen.queryByTestId('symptom-missing-severity-entry-severity'),
      ).toBeNull();

      const selector = screen.getByTestId('symptom-select-active-entry');
      expect(selector.props.accessibilityLabel).toBe(
        '증상 기록 선택: 직접 작성한 증상 설명',
      );
      await fireEvent.press(selector);
      expect(
        screen.getByTestId('symptom-select-active-entry').props
          .accessibilityLabel,
      ).toBe('선택한 증상 기록: 직접 작성한 증상 설명');
    });
  },
);

it('localizes the loading state', async () => {
  await renderScreen({ loading: true });
  expect(screen.getByTestId('symptoms-loading')).toHaveTextContent(
    '증상 기록을 불러오는 중…',
  );
});

it('localizes the empty state', async () => {
  await renderScreen();
  expect(screen.getByTestId('symptoms-empty')).toHaveTextContent(
    '이 조건에 맞는 증상 기록이 없어요.',
  );
});

it('localizes form guidance, accessibility names, and save errors', async () => {
  const onCreate = jest
    .fn()
    .mockRejectedValue(new Error('storage unavailable'));
  await renderScreen({ onCreate });
  await fireEvent.press(screen.getByTestId('symptom-add'));
  expect(
    screen.getByTestId('symptom-description').props.accessibilityLabel,
  ).toBe('증상 내용');
  expect(
    screen.getByTestId('symptom-onset-date').props.accessibilityLabel,
  ).toBe('증상 시작 날짜');
  expect(screen.getByTestId('symptom-status-active')).toHaveTextContent(
    '계속되고 있어요',
  );
  await fireEvent.changeText(
    screen.getByTestId('symptom-description'),
    '합성 증상',
  );
  await fireEvent.changeText(
    screen.getByTestId('symptom-onset-date'),
    '2026-04-20',
  );
  await fireEvent.changeText(screen.getByTestId('symptom-onset-time'), '08:30');
  await fireEvent.press(screen.getByTestId('symptom-status-active'));
  await fireEvent.press(screen.getByTestId('symptom-save'));
  expect(await screen.findByTestId('symptom-form-error')).toHaveTextContent(
    '증상 기록을 저장하지 못했어요. 다시 시도해 주세요.',
  );
});
