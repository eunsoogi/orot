import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Button } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useInferenceConsent } from '../../../agent/execution/useInferenceConsent';
import { createPublicWebEvidence } from '../publicWebEvidence';
import { runDefaultPublicSearch } from '../defaultPublicSearch';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

test.each([false, true])(
  'public search sends only after the consent screen is allowed: %s',
  async allow => {
    const fixture = publicEvidenceFixture();
    const onResult = jest.fn();
    function Harness() {
      const { consent, disclosureSheet } = useInferenceConsent();
      const web = createPublicWebEvidence({
        selected: fixture.selected,
        consent,
      });
      function start() {
        // Leave the screen interactive while its consent decision is pending.
        runDefaultPublicSearch({
          tool: web?.tool,
          operationRunId: 'public-search-screen',
          request: '김테스트 혈압 170/100',
          signal: fixture.controller.signal,
        }).then(onResult);
      }
      return (
        <>
          <Button title="Search" testID="search" onPress={start} />
          {disclosureSheet}
        </>
      );
    }
    const view = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 430, height: 800 },
          insets: { top: 0, right: 0, bottom: 24, left: 0 },
        }}
      >
        <Harness />
      </SafeAreaProvider>,
    );
    await fireEvent.press(view.getByTestId('search'));
    expect(await view.findByTestId('inference-disclosure-sheet')).toBeTruthy();
    expect(fixture.search).not.toHaveBeenCalled();
    expect(
      await view.findByText(
        'General public health information about: blood pressure. Guidelines, associations, possible explanations and limitations.',
      ),
    ).toBeTruthy();
    expect(view.queryByText(/김테스트|170\/100/)).toBeNull();
    await fireEvent.press(
      view.getByTestId(
        allow ? 'inference-disclosure-allow' : 'inference-disclosure-cancel',
      ),
    );
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({
          status: allow ? 'success' : 'consent_required',
        }),
      ),
    );
    expect(fixture.search).toHaveBeenCalledTimes(allow ? 1 : 0);
    if (allow)
      expect(fixture.search.mock.calls[0]![0].query).not.toMatch(
        /김테스트|170\/100/,
      );
  },
);
