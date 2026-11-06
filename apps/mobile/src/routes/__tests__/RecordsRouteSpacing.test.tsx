import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { RecordsRoute } from '../RecordsRoute';
import { hubSpacing } from '../../layout/hubSpacing';
import { NavigationRouteScrollView } from '../../navigation/NavigationRouteScrollView';
import { NavigationOcclusionContext } from '../../navigation/useNavigationContentInset';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

test('reserves the navigation overlap and the Records end gutter only once', async () => {
  await render(
    <NavigationOcclusionContext.Provider
      value={{
        placement: 'bottom',
        systemInsets: { top: 0, right: 0, bottom: 34, left: 0 },
        viewportInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        scrollContentInsets: { top: 0, right: 0, bottom: 52, left: 0 },
      }}
    >
      <NavigationRouteScrollView>
        <RecordsRoute
          recordings={[]}
          recordingState="ready"
          onRetryRecordings={jest.fn()}
          onOpenSavedRecordings={jest.fn()}
          onOpenRecording={jest.fn()}
          onOpenHealthLibrary={jest.fn()}
          onOpenManualHistory={jest.fn()}
        />
      </NavigationRouteScrollView>
    </NavigationOcclusionContext.Provider>,
  );
  const scroll = StyleSheet.flatten(
    screen.getByTestId('navigation-route-scroll').props.contentContainerStyle,
  );
  const page = StyleSheet.flatten(
    screen.getByTestId('records-layout').props.style,
  );
  expect(scroll.paddingBottom + page.paddingBottom).toBe(
    52 + hubSpacing.bottom,
  );
});
