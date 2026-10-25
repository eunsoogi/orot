import AVFoundation
import Foundation

/// Shared by production recording and the isolated microphone probe; no audio crosses this boundary.
enum RecordingMetering {
    static func amplitude(recorder: AVAudioRecorder?, recording: Bool) -> Double {
        guard recording, let recorder else { return 0 }
        recorder.updateMeters()
        let power = Double(recorder.averagePower(forChannel: 0))
        // Linear amplitude in [0, 1]; values below -60 dBFS render as silence.
        return power > -60 ? min(1, max(0, pow(10, power / 20))) : 0
    }

    /// Returns a suspended timer; owners install their state handler before resuming it.
    static func timer(queue: DispatchQueue) -> DispatchSourceTimer {
        let source = DispatchSource.makeTimerSource(queue: queue)
        source.schedule(deadline: .now(), repeating: .milliseconds(100))
        return source
    }
}
