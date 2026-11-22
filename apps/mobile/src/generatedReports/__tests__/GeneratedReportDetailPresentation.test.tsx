import { createDailyReportIdentity } from '@orot/domain';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
import { formatDateTime, t } from '../../i18n';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import {
  GeneratedReportDetailPresentation,
  type GeneratedReportDetailPresentationState,
} from '../GeneratedReportDetailPresentation';
import { generatedReportCopy } from '../text';
import type { GeneratedReportRow } from '../types';

const item: GeneratedReportRow = {
  key: 'summary:fixture',
  id: 'fixture',
  origin: 'summary',
  kind: 'daily_report',
  createdAt: '2035-04-01T07:25:00.000Z',
  unavailable: false,
};
const noRetry = () => {
  throw new Error('unexpected attempt to retry');
};
const neverCurrent = () => false;

test.each([
  ['daily_report', 'summary', '보관 위치: 저장된 분석'],
  ['health_summary', 'summary', '보관 위치: 저장된 분석'],
  ['possibilities', 'conversation', '보관 위치: 대화'],
  ['visit_questions', 'visit', '보관 위치: 저장된 진료 질문'],
] as const)(
  'leads with the actual %s material title, not collection framing',
  async (kind, origin, location) => {
    await render(
      <GeneratedReportDetailPresentation
        row={{ ...item, kind, origin }}
        state={{ status: 'loading' }}
        onRetry={noRetry}
        isCurrent={neverCurrent}
      />,
    );
    expect(screen.getAllByRole('header')).toHaveLength(1);
    expect(screen.getByRole('header')).toHaveTextContent(
      generatedReportCopy[kind],
    );
    expect(screen.getByText(location)).toBeVisible();
    expect(
      screen.getByText(
        `기록 시각: ${formatDateTime(new Date(item.createdAt))}`,
      ),
    ).toBeVisible();
    expect(screen.queryByText(generatedReportCopy.title)).toBeNull();
    expect(
      screen.queryByText(t('records.generatedConversationMaterials')),
    ).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    const loading = screen.getByText('이 자료를 불러오는 중이에요.');
    expect(loading.props.accessibilityState?.busy).toBe(true);
    expect(loading.props.accessibilityLiveRegion).toBe('polite');
    expect(
      screen.getByTestId('generated-material-detail-progress', {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    expect(screen.queryByTestId('generated-report-detail')).toBeNull();
  },
);

test('only recoverable failure offers Retry; unavailable originals are never presented as current', async () => {
  const retry = jest.fn();
  const renderState = (state: GeneratedReportDetailPresentationState) => (
    <GeneratedReportDetailPresentation
      row={item}
      state={state}
      onRetry={retry}
      isCurrent={neverCurrent}
    />
  );
  const view = await render(renderState({ status: 'failed' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    '이 자료를 불러오지 못했어요.',
  );
  expect(retry).not.toHaveBeenCalled();
  const action = screen.getByRole('button', {
    name: generatedReportCopy.retry,
  });
  expect(
    StyleSheet.flatten(action.props.style).minHeight,
  ).toBeGreaterThanOrEqual(44);
  await fireEvent.press(action);
  expect(retry).toHaveBeenCalledTimes(1);
  await view.rerender(renderState({ status: 'unavailable' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    '현재 열 수 없는 자료예요.',
  );
  expect(screen.getByText(generatedReportCopy.unavailable)).toBeVisible();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByTestId('generated-report-detail')).toBeNull();
  expect(retry).toHaveBeenCalledTimes(1);
});

const long = '합성 자료의 문장입니다. 두 번째 문장까지 그대로 유지해요. '
  .repeat(30)
  .trim();

test.each([320, 840])(
  'keeps a single wrapping reader column in a %ipt host',
  async width => {
    await render(
      <View testID="detail-width-host" style={{ width }}>
        <NavigationMotionContext.Provider value>
          <GeneratedReportDetailPresentation
            row={item}
            state={{
              status: 'ready',
              detail: {
                warning: '합성 출처 경고',
                paragraphs: [long],
                daily: {
                  schemaVersion: 1,
                  identity: createDailyReportIdentity('2035-04-01', 'UTC'),
                  generatedAt: item.createdAt,
                  observations: [],
                  supportedContext: [],
                  followUpQuestions: [],
                  coverage: [
                    {
                      source: 'calendar',
                      status: 'partial',
                      limitationCodes: ['snapshot_incomplete'],
                    },
                  ],
                },
              },
              generation: 1,
            }}
            onRetry={noRetry}
            isCurrent={neverCurrent}
          />
        </NavigationMotionContext.Provider>
      </View>,
    );
    const surface = StyleSheet.flatten(
      screen.getByTestId('generated-material-detail').props.style,
    );
    expect(surface).toMatchObject({
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
    });
    expect(surface.height).toBeUndefined();
    expect(surface.backgroundColor).toBeUndefined();
    expect(screen.getByText('합성 출처 경고')).toBeVisible();
    const paragraph = screen.getByTestId('generated-report-paragraph-0');
    expect(paragraph).toHaveTextContent(long);
    expect(paragraph.props.numberOfLines).toBeUndefined();
    expect(paragraph.props.allowFontScaling).not.toBe(false);
    expect(screen.getAllByRole('header')[0]).toHaveTextContent(
      generatedReportCopy.daily_report,
    );
    expect(screen.getByRole('header', { name: '저장된 내용' })).toBeVisible();
    const title = screen.getByTestId('generated-material-detail-title');
    expect(StyleSheet.flatten(title.props.style)).toMatchObject({
      color: appColors.text,
      fontSize: 28,
    });
    expect(title.props.allowFontScaling).not.toBe(false);
    expect(
      screen.getByText(generatedReportCopy.sourceNavigationUnavailable),
    ).toBeVisible();
    await fireEvent.press(
      screen.getByRole('button', {
        name: `하루 범위: ${t('dailyReport.coverage.details.show')}`,
      }),
    );
    expect(
      screen.getByRole('button', {
        name: `하루 범위: ${t('dailyReport.coverage.details.hide')}`,
      }),
    ).toBeVisible();
  },
);

test('passes through the exact original bookmark and removes it when readiness is lost', async () => {
  let current = false;
  const isCurrent = () => current;
  const bookmark = jest.fn(async (guard: () => boolean) => guard());
  const show = (state: GeneratedReportDetailPresentationState) => (
    <GeneratedReportDetailPresentation
      row={{ ...item, kind: 'possibilities' }}
      state={state}
      onRetry={noRetry}
      isCurrent={isCurrent}
    />
  );
  const view = await render(
    show({
      status: 'ready',
      generation: 2,
      detail: { paragraphs: ['보관 전 합성 원본'], bookmarkOriginal: bookmark },
    }),
  );
  const action = screen.getByTestId('generated-report-bookmark-original');
  await fireEvent.press(action);
  expect(bookmark).not.toHaveBeenCalled();
  current = true;
  await fireEvent.press(action);
  expect(bookmark).toHaveBeenCalledTimes(1);
  expect(bookmark).toHaveBeenCalledWith(isCurrent);
  current = false;
  await view.rerender(
    <NavigationMotionContext.Provider value>
      {show({ status: 'loading' })}
      <AppText>외부 내비게이션 소유 화면</AppText>
    </NavigationMotionContext.Provider>,
  );
  expect(
    screen.queryByTestId('generated-material-detail-progress', {
      includeHiddenElements: true,
    }),
  ).toBeNull();
  expect(screen.queryByText('보관 전 합성 원본')).toBeNull();
  expect(screen.queryByTestId('generated-report-bookmark-original')).toBeNull();
  expect(screen.getByText('이 자료를 불러오는 중이에요.')).toBeVisible();
});
