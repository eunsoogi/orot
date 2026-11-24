import Foundation
@testable import Orot
import XCTest

enum RealtimeVoiceNativeRegistryAssertions {
    static func assertAudioOnlySessionAdvertisesNoToolsOrRecordAccess() throws {
        let event = RealtimeVoiceCall.configuration(model: "gpt-live-1.1", language: "ko")
        let session = try XCTUnwrap(event["session"] as? [String: Any])
        let delegation = try XCTUnwrap(session["delegation"] as? [String: String])
        XCTAssertEqual(delegation, ["type": "client"])
        let instruction = try XCTUnwrap(session["instructions"] as? String)
        XCTAssertTrue(instruction.contains("Do not claim to access records or perform actions"))
        XCTAssertTrue(instruction.contains("Prefer Korean"))
    }

    static func assertExactOwnedRegistryMatchesWireAndRejectsUnknownOrRevokedAdmission() throws {
        for model in ["gpt-6-luna", "gpt-6-sol"] {
            let owned = admission(model: model, functionName: "orot_health_context", allowed: true)
            let registry = try XCTUnwrap(LiveNativeToolRegistry(admission: owned))
            let configuration = try XCTUnwrap(registry.configuration(for: owned))
            let responses = try XCTUnwrap(configuration["responses"] as? [String: Any])
            XCTAssertEqual(responses["model"] as? String, model)
            let tools = try XCTUnwrap(responses["tools"] as? [[String: Any]])
            XCTAssertEqual(tools.compactMap { $0["name"] as? String }, ["orot_health_context"])
            let parameters = try XCTUnwrap(tools.first?["parameters"] as? [String: Any])
            XCTAssertEqual(parameters["required"] as? [String], ["topic", "days"])
            XCTAssertEqual(parameters["additionalProperties"] as? Bool, false)
            XCTAssertTrue(registry.allows("orot_health_context"))
            XCTAssertFalse(registry.allows("orot_personal_records"))
            XCTAssertFalse(registry.allows("orot_reviewed_memory"))
            XCTAssertNil(registry.configuration(for: admission(model: model, functionName: "orot_health_context", allowed: false)))
            XCTAssertNil(LiveNativeToolRegistry(admission: admission(model: model, functionName: "orot_personal_records", allowed: true)))
            let instruction = RealtimeVoiceCall.instructions(language: "en", tools: registry.eligible)
            XCTAssertTrue(instruction.contains("one bounded ordinary heart-rate average"))
            XCTAssertTrue(instruction.contains("do not claim other record access"))
        }
    }

    private static func admission(model: String, functionName: String, allowed: Bool) -> LiveResponsesAdmission {
        LiveResponsesAdmission(
            backendModel: model, functionName: functionName, backendAllowed: { allowed },
            mayRun: { _ in false }, approve: { _, finish in finish(false); return {} },
            execute: { _, finish in finish(nil); return {} }, mayDisclose: { _, _ in false },
        )
    }
}
