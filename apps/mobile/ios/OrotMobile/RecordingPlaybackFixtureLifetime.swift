#if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST
    import AVFoundation
    import Foundation

    /// Only the explicit Stop fixture loops the actual saved file. One-shot completion uses a separate resume launch.
    /// The player, its clock and progress events remain real; production and excerpt playback stay one-shot.
    enum RecordingPlaybackFixtureLifetime {
        static func configure(_ player: AVAudioPlayer, synthetic: Bool, start: Int, end: Int,
                              mode: String? = UserDefaults.standard.string(forKey: "OROT_RECORDING_PLAYBACK_PROBE"))
        {
            if synthetic, start == 0, abs(Double(end) - player.duration * 1000) <= 10,
               mode == "seed" || mode == "route"
            {
                player.numberOfLoops = -1
            }
        }
    }
#endif
