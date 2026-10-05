import AVFoundation
import Foundation

enum SpeechTranscriptionAudioStore {
    private static let staleFileAge: TimeInterval = 24 * 60 * 60
    private static let conversionChunkSize: AVAudioFrameCount = 4096

    static func withAnalyzerCompatibleAudio<T>(
        _ file: SpeechTranscriptionAudioFile,
        format: AVAudioFormat,
        allowUnverifiedProtectionForSyntheticFixture: Bool,
        operation: (SpeechTranscriptionAudioFile) async throws -> T,
    ) async throws -> T {
        let url = file.url.deletingLastPathComponent()
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("caf")
        defer { try? FileManager.default.removeItem(at: url) }

        do {
            try createAnalyzerCompatibleFile(
                from: file.url,
                to: url,
                format: format,
                allowUnverifiedProtectionForSyntheticFixture: allowUnverifiedProtectionForSyntheticFixture,
            )
        } catch let failure as SpeechTranscriptionFailure {
            throw failure
        } catch {
            throw SpeechTranscriptionFailure("AUDIO_CONVERSION_FAILED", "The audio could not be converted to a format supported by Apple on-device speech.")
        }
        return try await operation(SpeechTranscriptionAudioFile(url: url, durationSeconds: file.durationSeconds))
    }

    /// The bytes exist only in protected, non-backed-up cache storage and the current file is removed on every exit.
    static func withProtectedAudio<T>(
        base64: String,
        mediaType: String,
        allowUnverifiedProtectionForSyntheticFixture: Bool,
        operation: (SpeechTranscriptionAudioFile) async throws -> T,
    ) async throws -> T {
        guard let data = Data(base64Encoded: base64), !data.isEmpty else {
            throw SpeechTranscriptionFailure("INVALID_AUDIO", "Audio data is empty or invalid Base64.")
        }
        guard let fileExtension = supportedExtension(mediaType) else {
            throw SpeechTranscriptionFailure("UNSUPPORTED_MEDIA_TYPE", "The audio media type is not supported.")
        }

        let fileManager = FileManager.default
        guard let cacheURL = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            throw SpeechTranscriptionFailure("AUDIO_STORAGE_UNAVAILABLE", "The app cache directory is unavailable.")
        }
        let directory = cacheURL.appendingPathComponent("SpeechTranscription", isDirectory: true)
        try fileManager.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete],
        )
        try markExcludedFromBackup(directory)
        removeStaleFiles(in: directory, olderThan: Date().addingTimeInterval(-staleFileAge))

        let url = directory.appendingPathComponent(UUID().uuidString).appendingPathExtension(fileExtension)
        defer { try? fileManager.removeItem(at: url) }

        do {
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            try fileManager.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
            try markExcludedFromBackup(url)
            try verifyProtection(url, allowUnverifiedProtectionForSyntheticFixture: allowUnverifiedProtectionForSyntheticFixture)

            let audioFile = try AVAudioFile(forReading: url)
            let sampleRate = audioFile.processingFormat.sampleRate
            let duration = Double(audioFile.length) / sampleRate
            guard audioFile.length > 0, sampleRate.isFinite, sampleRate > 0, duration.isFinite, duration > 0 else {
                throw SpeechTranscriptionFailure("INVALID_AUDIO", "The audio file has no readable duration.")
            }
            return try await operation(SpeechTranscriptionAudioFile(url: url, durationSeconds: duration))
        } catch let failure as SpeechTranscriptionFailure {
            throw failure
        } catch {
            throw SpeechTranscriptionFailure("INVALID_AUDIO", "The audio bytes could not be opened as a supported audio file.")
        }
    }

    private static func supportedExtension(_ mediaType: String) -> String? {
        switch mediaType.split(separator: ";", maxSplits: 1).first?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "audio/aac": "aac"
        case "audio/caf", "audio/x-caf": "caf"
        case "audio/m4a", "audio/mp4", "audio/x-m4a": "m4a"
        case "audio/wav", "audio/x-wav": "wav"
        default: nil
        }
    }

    private static func markExcludedFromBackup(_ url: URL) throws {
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableURL = url
        try mutableURL.setResourceValues(values)
    }

    private static func verifyProtection(
        _ url: URL,
        allowUnverifiedProtectionForSyntheticFixture: Bool,
    ) throws {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        let protectionValue = attributes[.protectionKey]
        let protection = protectionValue as? FileProtectionType
        let excluded = try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup
        guard excluded == true else {
            throw protectionFailure(protectionValue: protectionValue, excluded: excluded)
        }
        guard protection != .complete else { return }

        #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
            let protectionIsUnobservable = protectionValue.map { _ in false } ?? true
            if allowUnverifiedProtectionForSyntheticFixture, protectionIsUnobservable {
                return
            }
        #endif

        throw protectionFailure(protectionValue: protectionValue, excluded: excluded)
    }

    private static func createAnalyzerCompatibleFile(
        from sourceURL: URL,
        to destinationURL: URL,
        format: AVAudioFormat,
        allowUnverifiedProtectionForSyntheticFixture: Bool,
    ) throws {
        guard format.sampleRate.isFinite, format.sampleRate > 0, format.channelCount > 0,
              AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1) != nil
        else {
            throw SpeechTranscriptionFailure("AUDIO_CONVERSION_FAILED", "Apple returned an invalid speech analyzer audio format.")
        }
        let source = try AVAudioFile(forReading: sourceURL)
        guard let converter = AVAudioConverter(from: source.processingFormat, to: format) else {
            throw SpeechTranscriptionFailure("AUDIO_CONVERSION_FAILED", "Apple's audio converter cannot convert this audio for speech recognition.")
        }
        let destination = try AVAudioFile(
            forWriting: destinationURL,
            settings: format.settings,
            commonFormat: format.commonFormat,
            interleaved: format.isInterleaved,
        )
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: destinationURL.path)
        try markExcludedFromBackup(destinationURL)
        try verifyProtection(
            destinationURL,
            allowUnverifiedProtectionForSyntheticFixture: allowUnverifiedProtectionForSyntheticFixture,
        )

        while source.framePosition < source.length {
            let remainingFrames = source.length - source.framePosition
            let requestedFrames = AVAudioFrameCount(min(Int64(conversionChunkSize), remainingFrames))
            guard let input = AVAudioPCMBuffer(pcmFormat: source.processingFormat, frameCapacity: conversionChunkSize) else {
                throw SpeechTranscriptionFailure("AUDIO_CONVERSION_FAILED", "The audio converter could not allocate an input buffer.")
            }
            try source.read(into: input, frameCount: requestedFrames)
            guard input.frameLength > 0 else { break }
            try convert(input, using: converter, to: destination, endOfStream: false)
        }
        try convert(nil, using: converter, to: destination, endOfStream: true)
        guard destination.length > 0 else {
            throw SpeechTranscriptionFailure("INVALID_AUDIO", "The audio converter produced no speech input frames.")
        }
    }

    private static func convert(
        _ input: AVAudioPCMBuffer?,
        using converter: AVAudioConverter,
        to destination: AVAudioFile,
        endOfStream: Bool,
    ) throws {
        var suppliedInput = false
        while true {
            let capacity = outputCapacity(for: input, converter: converter)
            guard let output = AVAudioPCMBuffer(pcmFormat: converter.outputFormat, frameCapacity: capacity) else {
                throw SpeechTranscriptionFailure("AUDIO_CONVERSION_FAILED", "The audio converter could not allocate an output buffer.")
            }
            var conversionError: NSError?
            let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
                guard let input, !suppliedInput else {
                    inputStatus.pointee = endOfStream ? .endOfStream : .noDataNow
                    return nil
                }
                suppliedInput = true
                inputStatus.pointee = .haveData
                return input
            }
            if let conversionError {
                throw conversionError
            }
            if output.frameLength > 0 {
                try destination.write(from: output)
            }

            switch status {
            case .haveData:
                guard output.frameLength > 0 else {
                    throw SpeechTranscriptionFailure("AUDIO_CONVERSION_FAILED", "The audio converter stopped producing output frames.")
                }
            case .inputRanDry, .endOfStream:
                return
            case .error:
                throw SpeechTranscriptionFailure("AUDIO_CONVERSION_FAILED", "Apple's audio converter could not process the input audio.")
            @unknown default:
                throw SpeechTranscriptionFailure("AUDIO_CONVERSION_FAILED", "Apple's audio converter returned an unknown conversion state.")
            }
        }
    }

    private static func outputCapacity(for input: AVAudioPCMBuffer?, converter: AVAudioConverter) -> AVAudioFrameCount {
        guard let input else { return conversionChunkSize }
        let ratio = converter.outputFormat.sampleRate / converter.inputFormat.sampleRate
        let frames = ceil(Double(input.frameLength) * ratio) + Double(conversionChunkSize)
        return AVAudioFrameCount(min(frames, Double(UInt32.max)))
    }

    private static func protectionFailure(protectionValue: Any?, excluded: Bool?) -> SpeechTranscriptionFailure {
        #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
            let protectionType = protectionValue.map { String(reflecting: type(of: $0)) } ?? "nil"
            let protectionDescription = protectionValue.map { String(describing: $0) } ?? "nil"
            let backupDescription = excluded.map { String(describing: $0) } ?? "nil"
            return SpeechTranscriptionFailure(
                "AUDIO_STORAGE_UNPROTECTED",
                "Temporary audio protection could not be verified (NSFileProtectionKey type=\(protectionType), value=\(protectionDescription), excludedFromBackup=\(backupDescription)).",
            )
        #else
            return SpeechTranscriptionFailure("AUDIO_STORAGE_UNPROTECTED", "Temporary audio protection could not be verified.")
        #endif
    }

    private static func removeStaleFiles(in directory: URL, olderThan cutoff: Date) {
        let fileManager = FileManager.default
        guard let files = try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles],
        ) else { return }
        for file in files {
            let resourceValues = try? file.resourceValues(forKeys: [.contentModificationDateKey])
            guard let modified = resourceValues?.contentModificationDate, modified < cutoff else { continue }
            try? fileManager.removeItem(at: file)
        }
    }
}
