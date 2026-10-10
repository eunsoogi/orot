const {
  dismissRecordingExportShareSheet,
} = require('../e2e/transcription/recordingExportDetoxHelpers');

describe('recording export share-sheet dismissal', () => {
  it.each([
    [
      { x: 0, y: 0, width: 402, height: 874 },
      { x: 201, y: 175 },
    ],
    [
      { x: 0.5, y: 1.25, width: 393, height: 852 },
      { x: 197, y: 172 },
    ],
  ])(
    'preserves the outside tap through the integer-only XCTest bridge',
    async (frame, target) => {
      const popup = { getAttributes: jest.fn().mockResolvedValue({ frame }) };
      const withTimeout = jest.fn().mockResolvedValue(undefined);
      let actualPoint;
      const device = {
        tap: jest.fn(async point => {
          // Detox 20.51.4 uses Swift Int(String); fractional strings fall back to 100.
          const decode = value =>
            /^-?\d+$/.test(String(value)) ? Number(value) : 100;
          actualPoint = { x: decode(point.x), y: decode(point.y) };
        }),
      };
      await dismissRecordingExportShareSheet({
        by: { label: label => label },
        device,
        element: jest.fn().mockReturnValue(popup),
        waitFor: () => ({
          toExist: () => ({ withTimeout }),
          not: { toExist: () => ({ withTimeout }) },
        }),
      });
      expect(device.tap).toHaveBeenCalledTimes(1);
      expect(actualPoint).toEqual(target);
    },
  );
});
