import AVFoundation
import Foundation
import Speech

@available(iOS 26.0, *)
enum SpeechTranscriptionAnalyzer {
  static func transcribe(
    _ file: SpeechTranscriptionAudioFile,
    allowUnverifiedProtectionForSyntheticFixture: Bool
  ) async throws -> [SpeechTranscriptionSegment] {
    let locale = Locale(identifier: SpeechTranscriptionLanguage.localeIdentifier)
    guard let supportedLocale = await SpeechTranscriber.supportedLocale(equivalentTo: locale) else {
      throw SpeechTranscriptionFailure("UNSUPPORTED_LANGUAGE", "Apple SpeechTranscriber does not support Korean on this device.")
    }

    // Enable source audio ranges without requesting alternatives or provisional results.
    let transcriber = makeTimeIndexedTranscriber(locale: supportedLocale)
    do {
      if let installation = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
        try await installation.downloadAndInstall()
      }
    } catch {
      throw SpeechTranscriptionFailure("MODEL_INSTALL_FAILED", "The Korean on-device speech model could not be installed.")
    }

    return try await analyze(
      file,
      module: transcriber,
      allowUnverifiedProtectionForSyntheticFixture: allowUnverifiedProtectionForSyntheticFixture,
      collectResults: { try await collectResults(from: transcriber, duration: file.durationSeconds) }
    )
  }

  static func transcribeWithDictation(
    _ file: SpeechTranscriptionAudioFile,
    allowUnverifiedProtectionForSyntheticFixture: Bool
  ) async throws -> [SpeechTranscriptionSegment] {
    let locale = Locale(identifier: SpeechTranscriptionLanguage.localeIdentifier)
    guard let supportedLocale = await DictationTranscriber.supportedLocale(equivalentTo: locale) else {
      throw SpeechTranscriptionFailure("UNSUPPORTED_LANGUAGE", "Apple DictationTranscriber does not support Korean on this device.")
    }

    // Consultation files can exceed a minute, and evidence links need the source audio time range.
    let transcriber = DictationTranscriber(locale: supportedLocale, preset: .timeIndexedLongDictation)
    do {
      if let installation = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
        try await installation.downloadAndInstall()
      }
    } catch {
      throw SpeechTranscriptionFailure("MODEL_INSTALL_FAILED", "The Korean on-device speech model could not be installed.")
    }

    return try await analyze(
      file,
      module: transcriber,
      allowUnverifiedProtectionForSyntheticFixture: allowUnverifiedProtectionForSyntheticFixture,
      collectResults: { try await collectDictationResults(from: transcriber, duration: file.durationSeconds) }
    )
  }

  static func makeTimeIndexedTranscriber(locale: Locale) -> SpeechTranscriber {
    let preset = SpeechTranscriber.Preset.timeIndexedTranscriptionWithAlternatives
    return SpeechTranscriber(
      locale: locale,
      transcriptionOptions: preset.transcriptionOptions,
      reportingOptions: preset.reportingOptions.subtracting([.alternativeTranscriptions]),
      attributeOptions: preset.attributeOptions
    )
  }

  private static func analyze(
    _ file: SpeechTranscriptionAudioFile,
    module: any SpeechModule,
    allowUnverifiedProtectionForSyntheticFixture: Bool,
    collectResults: @escaping @Sendable () async throws -> [SpeechTranscriptionSegment]
  ) async throws -> [SpeechTranscriptionSegment] {
    let bestAvailableFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module])
    let compatibleFormats = await module.availableCompatibleAudioFormats
    guard let supportedFormat = bestAvailableFormat ?? compatibleFormats.first else {
      throw SpeechTranscriptionFailure("MODEL_UNAVAILABLE", "Apple has no installed audio format for this on-device speech model.")
    }

    return try await SpeechTranscriptionAudioStore.withAnalyzerCompatibleAudio(
      file,
      format: supportedFormat,
      allowUnverifiedProtectionForSyntheticFixture: allowUnverifiedProtectionForSyntheticFixture
    ) { compatibleFile in
      let audioFile = try AVAudioFile(forReading: compatibleFile.url)
      let analyzer = SpeechAnalyzer(modules: [module])
      let results = Task { try await collectResults() }
      do {
        try await analyzer.start(inputAudioFile: audioFile, finishAfterFile: true)
        return try await results.value
      } catch {
        results.cancel()
        await analyzer.cancelAndFinishNow()
        throw SpeechTranscriptionFailure("SPEECH_RECOGNITION_FAILED", error.localizedDescription)
      }
    }
  }

  private static func collectResults(
    from transcriber: SpeechTranscriber,
    duration: Double
  ) async throws -> [SpeechTranscriptionSegment] {
    var segments: [SpeechTranscriptionSegment] = []
    for try await result in transcriber.results {
      let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
      if text.isEmpty { continue }
      let start = result.range.start.seconds
      let end = CMTimeRangeGetEnd(result.range).seconds
      try validate(start: start, end: end, duration: duration, previous: segments.last)
      segments.append(SpeechTranscriptionSegment(startSeconds: start, endSeconds: end, text: text))
    }
    return segments
  }

  private static func collectDictationResults(
    from transcriber: DictationTranscriber,
    duration: Double
  ) async throws -> [SpeechTranscriptionSegment] {
    var segments: [SpeechTranscriptionSegment] = []
    for try await result in transcriber.results {
      let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
      if text.isEmpty { continue }
      let start = result.range.start.seconds
      let end = CMTimeRangeGetEnd(result.range).seconds
      try validate(start: start, end: end, duration: duration, previous: segments.last)
      segments.append(SpeechTranscriptionSegment(startSeconds: start, endSeconds: end, text: text))
    }
    return segments
  }

  private static func validate(
    start: Double,
    end: Double,
    duration: Double,
    previous: SpeechTranscriptionSegment?
  ) throws {
    guard start.isFinite, end.isFinite, start >= 0, end > start,
      end <= duration + 0.1, previous.map({ start >= $0.startSeconds }) ?? true else {
      throw SpeechTranscriptionFailure("INVALID_TIMESTAMP", "Apple Speech returned an invalid audio time range.")
    }
  }
}
