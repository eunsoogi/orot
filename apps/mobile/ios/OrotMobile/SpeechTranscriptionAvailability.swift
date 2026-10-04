import Foundation
import Speech

enum SpeechTranscriptionAvailability {
  static func check(language: String) async -> SpeechTranscriptionAvailabilityResult {
    guard SpeechTranscriptionLanguage.isSupportedRequest(language) else {
      return .failure(.unsupportedLanguage, locale: language)
    }

    var speechTranscriberSupportsLocale = false
    if #available(iOS 26.0, *) {
      // Apple support varies by OS, model assets, and device; query the current device instead of hard-coding Korean support.
      let requestedLocale = Locale(identifier: SpeechTranscriptionLanguage.localeIdentifier)
      let speechLocale = await SpeechTranscriber.supportedLocale(equivalentTo: requestedLocale)
      speechTranscriberSupportsLocale = speechLocale != nil
      if let speechLocale, SpeechTranscriber.isAvailable {
        let transcriber = SpeechTranscriptionAnalyzer.makeTimeIndexedTranscriber(locale: speechLocale)
        let installed = await SpeechTranscriber.installedLocales
        let modelInstalled = installed.contains(where: matchesKorean)
        if modelInstalled, await transcriber.availableCompatibleAudioFormats.isEmpty {
          return SpeechTranscriptionAvailabilityResult(
            status: .modelUnavailable,
            engine: .speechTranscriber,
            locale: speechLocale.identifier,
            modelInstalled: true
          )
        }
        return SpeechTranscriptionAvailabilityResult(
          status: .available,
          engine: .speechTranscriber,
          locale: speechLocale.identifier,
          modelInstalled: modelInstalled
        )
      }

      if let dictationLocale = await DictationTranscriber.supportedLocale(equivalentTo: requestedLocale) {
        let installed = await DictationTranscriber.installedLocales
        let modelInstalled = installed.contains(where: matchesKorean)
        let transcriber = DictationTranscriber(locale: dictationLocale, preset: .timeIndexedLongDictation)
        if modelInstalled, await transcriber.availableCompatibleAudioFormats.isEmpty {
          return SpeechTranscriptionAvailabilityResult(
            status: .modelUnavailable,
            engine: .dictationTranscriber,
            locale: dictationLocale.identifier,
            modelInstalled: true
          )
        }
        return SpeechTranscriptionAvailabilityResult(
          status: .available,
          engine: .dictationTranscriber,
          locale: dictationLocale.identifier,
          modelInstalled: modelInstalled
        )
      }
    }

    let legacy = legacyAvailability()
    if legacy.status != .unsupportedLanguage { return legacy }
    if speechTranscriberSupportsLocale {
      return .failure(.unsupportedDevice, locale: SpeechTranscriptionLanguage.localeIdentifier)
    }
    return legacy
  }

  static func authorizationStatus() -> SFSpeechRecognizerAuthorizationStatus {
    SFSpeechRecognizer.authorizationStatus()
  }

  static func requestAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
    await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { status in
        continuation.resume(returning: status)
      }
    }
  }

  private static func legacyAvailability() -> SpeechTranscriptionAvailabilityResult {
    let locale = Locale(identifier: SpeechTranscriptionLanguage.localeIdentifier)
    guard let recognizer = SFSpeechRecognizer(locale: locale) else {
      return .failure(.unsupportedLanguage, locale: locale.identifier)
    }
    guard recognizer.supportsOnDeviceRecognition else {
      return .failure(.unsupportedDevice, locale: locale.identifier, engine: .onDeviceSpeechRecognizer)
    }
    guard recognizer.isAvailable else {
      return .failure(.recognizerUnavailable, locale: locale.identifier, engine: .onDeviceSpeechRecognizer)
    }

    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized:
      return SpeechTranscriptionAvailabilityResult(
        status: .available,
        engine: .onDeviceSpeechRecognizer,
        locale: locale.identifier,
        modelInstalled: nil
      )
    case .notDetermined:
      return .failure(.permissionNotDetermined, locale: locale.identifier, engine: .onDeviceSpeechRecognizer)
    case .denied:
      return .failure(.permissionDenied, locale: locale.identifier, engine: .onDeviceSpeechRecognizer)
    case .restricted:
      return .failure(.permissionRestricted, locale: locale.identifier, engine: .onDeviceSpeechRecognizer)
    @unknown default:
      return .failure(.recognizerUnavailable, locale: locale.identifier, engine: .onDeviceSpeechRecognizer)
    }
  }

  @available(iOS 26.0, *)
  private static func matchesKorean(_ locale: Locale) -> Bool {
    let identifier = locale.identifier.replacingOccurrences(of: "_", with: "-").lowercased()
    return identifier == "ko" || identifier.hasPrefix("ko-")
  }
}
