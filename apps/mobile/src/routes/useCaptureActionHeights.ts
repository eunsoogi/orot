import { useState } from 'react';

/** Measures unconstrained contents so equal peers adapt to viewport and text changes. */
export function useCaptureActionHeights(width: number, fontScale: number) {
  const [measurements, setMeasurements] = useState({
    key: '',
    heights: [0, 0],
  });
  const key = `${width}:${fontScale}`;
  const heights = measurements.key === key ? measurements.heights : [0, 0];
  function recordHeight(index: number, height: number) {
    setMeasurements(previous => {
      const next = previous.key === key ? [...previous.heights] : [0, 0];
      if (next[index] === height && previous.key === key) return previous;
      next[index] = height;
      return { key, heights: next };
    });
  }
  return { commonHeight: Math.max(...heights) + 24, recordHeight };
}
