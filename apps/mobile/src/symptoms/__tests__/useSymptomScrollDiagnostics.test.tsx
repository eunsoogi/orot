import { renderHook } from '@testing-library/react-native';
import { registerNavigationTestObserver } from '../../navigation/navigationTestObservation';
import useSymptomScrollDiagnostics from '../useSymptomScrollDiagnostics';

describe('symptom scroll diagnostics', () => {
  it('delivers an unavailable RN event type as null to the registered observer', async () => {
    // Exercise the real observation boundary so absence cannot become an invented event name.
    const sink = jest.fn();
    const uninstall = registerNavigationTestObserver(sink);
    try {
      const { result } = await renderHook(() => useSymptomScrollDiagnostics());
      result.current.observeScroll(undefined, {});
      expect(sink).toHaveBeenCalledTimes(1);
      expect(sink.mock.calls[0][0].event).toBe('symptom-scroll-diagnostic');
      expect(sink.mock.calls[0][0].phase).toBeNull();
    } finally {
      uninstall();
    }
  });
});
