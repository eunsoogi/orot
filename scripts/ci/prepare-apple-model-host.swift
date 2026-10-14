import Darwin
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

/// Read fixed, non-identifying kernel metadata. A failed query stays unknown rather than implying a supported host.
func hostString(_ name: String) -> String? {
    var size = 0
    guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return nil }
    var bytes = [CChar](repeating: 0, count: size)
    guard sysctlbyname(name, &bytes, &size, nil, 0) == 0 else { return nil }
    return String(decoding: bytes.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
}

/// This flag is a virtualization hint, not an Apple Intelligence eligibility test; the public SDK availability remains authoritative.
func virtualizationHint() -> Bool? {
    var value: Int32 = 0
    var size = MemoryLayout.size(ofValue: value)
    guard sysctlbyname("kern.hv_vmm_present", &value, &size, nil, 0) == 0 else { return nil }
    return value != 0
}

let model = SystemLanguageModel.default
let rawBefore = String(reflecting: model.availability)
let before = availability(model)
let started = Date()
// This call requests memory preparation only. Subsequent native tests must still observe availability and execute their original generation assertions.
LanguageModelSession(model: model).prewarm()
let report: [String: Any] = [
    "scope": "host-sdk-prewarm", "before": before, "after": availability(model),
    // Preserve the public enum independently of Orot's mapped label for host-versus-Simulator diagnosis.
    "rawBefore": rawBefore, "rawAfter": String(reflecting: model.availability),
    "prewarmInvoked": true, "generatedFixture": false,
    "koreanSupported": model.supportsLocale(Locale(identifier: "ko-KR")),
    "macOS": ProcessInfo.processInfo.operatingSystemVersionString,
    "hardwareModel": hostString("hw.model").map { $0 as Any } ?? NSNull(),
    "cpu": hostString("machdep.cpu.brand_string").map { $0 as Any } ?? NSNull(),
    "virtualizationHint": virtualizationHint().map { $0 as Any } ?? NSNull(),
    "physicalMemoryBytes": ProcessInfo.processInfo.physicalMemory,
    "elapsedMs": Date().timeIntervalSince(started) * 1000,
]
let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
