import Foundation

/// Only the platform objects are doubles. The actual native completion and test lifetime sources are compiled unchanged.
final class AVAudioPlayer {
    var currentTime = 1.25
    var duration = 2.584717
    var numberOfLoops = 0
    var delegate: AnyObject?
    var stops = 0
    func stop() {
        stops += 1; currentTime = 0
    }
}

public final class RecordingModule {
    var playbackPlayer: AVAudioPlayer? = AVAudioPlayer()
    var playbackTimer: DispatchSourceTimer?
    var playbackResolve: ((Any?) -> Void)?
    var playbackReject: ((String?, String?, NSError?) -> Void)?
    var playbackResult: NSDictionary? = ["startMs": 0, "endMs": 2585, "actualStartMs": 0]
    var playbackRecordingID: String? = "saved"
    var playbackEndMs: Int? = 2585
    var emissions = 0
    var deactivations = 0
    func deactivateAudioSession() {
        deactivations += 1
    }

    func emitPlaybackState() {
        emissions += 1
    }
}

@main
enum RecordingPlaybackCompletionHostRegression {
    static func main() async throws {
        var failures = 0
        func check(_ condition: Bool, _ name: String) {
            print("\(condition ? "PASS" : "FAIL") \(name)")
            if !condition {
                failures += 1
            }
        }
        let stopped = RecordingModule()
        let player = stopped.playbackPlayer!
        var receipt: [String: Any]?
        stopped.playbackResolve = { receipt = $0 as? [String: Any] }
        stopped.stopPlayback()
        check(receipt?["completion"] as? String == "stopped", "Explicit stop retains its native reason")
        check(receipt?["actualEndMs"] as? Int == 1250, "Real clock is captured before stop resets it")
        check(player.stops == 1 && stopped.playbackPlayer == nil && stopped.playbackResolve == nil,
              "Stop releases the player and pending callback")
        stopped.stopPlayback()
        check(player.stops == 1 && stopped.emissions == 1 && stopped.deactivations == 1,
              "Late duplicate completion cannot repeat settlement or cleanup")
        #if !BASELINE
            let natural = RecordingModule()
            natural.playbackResolve = { receipt = $0 as? [String: Any] }
            natural.stopPlayback(completed: true)
            check(receipt?["completion"] as? String == "completed" && receipt?["actualEndMs"] as? Int == 2585,
                  "Native finish retains the completed range")
            let rejected = RecordingModule()
            var code: String?
            rejected.playbackResolve = { _ in check(false, "Native failure cannot resolve success") }
            rejected.playbackReject = { value, _, _ in code = value }
            rejected.stopPlayback(code: "NATIVE_FAILURE")
            check(code == "NATIVE_FAILURE" && rejected.playbackReject == nil, "Original native failure propagates once")
            for (mode, synthetic, start, end, loops) in [
                ("seed", true, 0, 2585, -1), ("route", true, 0, 2585, -1),
                ("resume", true, 0, 2585, 0), ("seed", false, 0, 2585, 0), ("seed", true, 1000, 2000, 0),
            ] {
                let actual = AVAudioPlayer()
                RecordingPlaybackFixtureLifetime.configure(actual, synthetic: synthetic, start: start, end: end, mode: mode)
                check(actual.numberOfLoops == loops, "Only synthetic whole-source Stop fixtures loop: \(mode)/\(synthetic)/\(start)")
            }
        #endif
        if failures > 0 {
            exit(1)
        }
    }
}
