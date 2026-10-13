import Foundation
import FoundationModels

/// Prewarm the public host SDK without generating a fixture or claiming that model assets were installed.
func availability(_ model: SystemLanguageModel) -> String {
    switch model.availability {
    case .available: "available"
    case let .unavailable(reason):
        switch reason {
        case .deviceNotEligible: "unsupportedDevice"
        case .appleIntelligenceNotEnabled: "disabled"
        case .modelNotReady: "modelNotReady"
        @unknown default: "unknown"
        }
    }
}

let model = SystemLanguageModel.default
let before = availability(model)
let started = Date()
// This call requests memory preparation only. Subsequent native tests must still observe availability and execute their original generation assertions.
LanguageModelSession(model: model).prewarm()
let report: [String: Any] = [
    "scope": "host-sdk-prewarm", "before": before, "after": availability(model),
    "prewarmInvoked": true, "generatedFixture": false,
    "koreanSupported": model.supportsLocale(Locale(identifier: "ko-KR")),
    "macOS": ProcessInfo.processInfo.operatingSystemVersionString,
    "elapsedMs": Date().timeIntervalSince(started) * 1000,
]
let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
