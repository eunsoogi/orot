#if DEBUG && targetEnvironment(simulator)
    import AVFoundation
    import Foundation

    final class RecordingSyntheticCapture {
        private var output: AVAudioFile?
        private let sampleRate = 16000.0
        private var frameIndex: AVAudioFramePosition = 0

        var durationMs: Int {
            Int(frameIndex * 1000 / Int64(sampleRate))
        }

        init(url: URL) throws {
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: sampleRate,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 32,
                AVLinearPCMIsFloatKey: true,
                AVLinearPCMIsBigEndianKey: false,
            ]
            output = try AVAudioFile(
                forWriting: url,
                settings: settings,
                commonFormat: .pcmFormatFloat32,
                interleaved: false,
            )
        }

        func appendSyntheticAudio(milliseconds: Int = 100) throws {
            guard let output else { throw RecordingSyntheticCaptureError.closed }
            let frameCount = AVAudioFrameCount(sampleRate * Double(milliseconds) / 1000)
            guard
                let buffer = AVAudioPCMBuffer(pcmFormat: output.processingFormat, frameCapacity: frameCount),
                let channel = buffer.floatChannelData?[0]
            else {
                throw RecordingSyntheticCaptureError.bufferUnavailable
            }

            buffer.frameLength = frameCount
            for offset in 0 ..< Int(frameCount) {
                let sample = sin(2 * Double.pi * 440 * Double(frameIndex + Int64(offset)) / sampleRate)
                channel[offset] = Float(sample * 0.12)
            }
            try output.write(from: buffer)
            frameIndex += Int64(frameCount)
        }

        func close() {
            output = nil
        }
    }

    private enum RecordingSyntheticCaptureError: Error {
        case closed
        case bufferUnavailable
    }
#endif
