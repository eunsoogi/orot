// Compile alongside production SpeechTranscriptionAvailability.swift and SpeechTranscriptionTypes.swift.
// These deterministic routing checks do not establish device model availability or transcription.
import Foundation
import Speech

// Availability's analyzer dependency only constructs a module. No analyzer execution is mocked here.
@available(macOS 26.0, *)
enum SpeechTranscriptionAnalyzer {
  static func makeTimeIndexedTranscriber(locale: Locale) -> SpeechTranscriber {
    SpeechTranscriber(locale: locale, preset: .timeIndexedTranscriptionWithAlternatives)
  }
}

@main
struct AvailabilityRegression {
  static func main() async {
    for engine in [SpeechTranscriptionEngineKind.speechTranscriber, .dictationTranscriber] {
      for assetStatus in [AssetInventory.Status.supported, .downloading] {
        let result = await SpeechTranscriptionAvailability.configurationAvailability(
          assetStatus: assetStatus, engine: engine, locale: "ko_KR",
          hasCompatibleFormat: { fatalError("Pending assets must reach installation without a format query") }
        )
        require(result.status == .available && result.modelInstalled == false, "Pending assets blocked installation")
        require(result.engine == engine && result.locale == "ko_KR", "Engine or locale changed")
      }
      let unsupported = await SpeechTranscriptionAvailability.configurationAvailability(
        assetStatus: .unsupported, engine: engine, locale: "ko_KR",
        hasCompatibleFormat: { fatalError("Unsupported configuration queried formats") }
      )
      require(unsupported.status == .unsupportedDevice && unsupported.modelInstalled == false,
              "Unsupported configuration was treated as installable")
      for hasFormat in [false, true] {
        var queries = 0
        let result = await SpeechTranscriptionAvailability.configurationAvailability(
          assetStatus: .installed, engine: engine, locale: "ko_KR",
          hasCompatibleFormat: { queries += 1; return hasFormat }
        )
        require(queries == 1 && result.modelInstalled == true, "Installed assets were not checked")
        require(result.status == (hasFormat ? .available : .modelUnavailable), "Installed format state was ignored")
      }
    }
    let unsupportedLanguage = await SpeechTranscriptionAvailability.check(language: "en-US")
    require(unsupportedLanguage.status == .unsupportedLanguage, "Unsupported language reached native model queries")
    print("PASS: 10 configuration routes and unsupported-language guard")
  }

  static func require(_ condition: Bool, _ message: String) {
    if !condition { fatalError(message) }
  }
}
