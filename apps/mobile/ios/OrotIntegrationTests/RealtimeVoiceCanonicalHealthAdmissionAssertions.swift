import Foundation
@testable import Orot
import XCTest

extension RealtimeVoiceLifecycleTests {
    func assertCanonicalGrantRequiresItsOwnCurrentDeviceBindingAndLegacyOwner() throws {
        let legacy = String(repeating: "a", count: 64)
        let new = String(repeating: "b", count: 64)
        let credential = String(repeating: "c", count: 64)
        let old = try XCTUnwrap(LiveResponsesSettingsGrant([
            "backendModel": "gpt-6-sol", "grantID": legacy + "-model", "generation": legacy,
        ]))
        let companion: [String: Any] = [
            "version": 2, "capability": "canonical-health-context-result-v2", "backendModel": "gpt-6-sol",
            "grantID": new + "-model", "generation": new, "legacyGeneration": legacy, "credentialEpoch": credential,
        ]
        let grant = try XCTUnwrap(RealtimeVoiceCanonicalHealthAdmission(companion))
        var status = "active"
        var present = false
        var epoch = credential
        let read: (String, String) -> [String: Any]? = { service, _ in
            switch service {
            case "com.orot.mobile.settings-consent-authority.v1.voice-responses":
                ["version": 1, "status": "active", "generation": legacy]
            case "com.orot.mobile.settings-consent-authority.v1.voice-responses-health-context":
                ["version": 1, "status": status, "generation": new]
            case "com.orot.mobile.voice-settings.v1":
                ["apiKey": "synthetic-test-only", "credentialEpoch": epoch, "mode": "openai-api", "model": "gpt-live-1.1"]
            case "com.orot.mobile.live-responses-settings.v1":
                ["version": 1, "backendModel": "gpt-6-sol", "grantID": legacy + "-model", "generation": legacy, "credentialEpoch": credential]
            case "com.orot.mobile.live-health-context.v2":
                present ? companion : nil
            default:
                nil
            }
        }
        XCTAssertFalse(grant.current(base: old, key: "synthetic-test-only", read: read))
        present = true
        XCTAssertTrue(grant.current(base: old, key: "synthetic-test-only", read: read))
        let declaration: [String: Any] = [
            "name": "local-health-context", "description": "Synthetic canonical schema",
            "strict": false, "parameters": [
                "type": "object", "additionalProperties": false,
                "properties": ["days": [:], "topics": [:], "detail": [:], "window": [:]],
            ],
        ]
        let config = try XCTUnwrap(grant.configuration(declaration, base: old, key: "synthetic-test-only", read: read))
        let responses = try XCTUnwrap(config["responses"] as? [String: Any])
        XCTAssertEqual(responses["model"] as? String, "gpt-6-sol")
        var renamed = declaration
        renamed["name"] = "orot_health_context"
        XCTAssertNil(grant.configuration(renamed, base: old, key: "synthetic-test-only", read: read))
        status = "revoked"
        XCTAssertFalse(grant.current(base: old, key: "synthetic-test-only", read: read))
        status = "active"
        epoch = String(repeating: "d", count: 64)
        XCTAssertFalse(grant.current(base: old, key: "synthetic-test-only", read: read))
    }

    func assertOnlyCanonicalFieldsAndUniquelyScopedResultReferencesCross() {
        typealias Admission = RealtimeVoiceCanonicalHealthAdmission
        XCTAssertTrue(Admission.boundedArguments(#"{"days":7,"topics":["measurements"]}"#))
        XCTAssertFalse(Admission.boundedArguments(#"{"topic":"measurements","days":3}"#))
        XCTAssertFalse(Admission.boundedArguments(#"["unowned"]"#))
        XCTAssertFalse(Admission.boundedArguments(String(repeating: " ", count: 1025)))
        let content = String(repeating: "x", count: 2400)
        let exact = #"{"tool":"local-health-context","items":[{"evidenceId":"issued","evidenceRevision":"current","content":""# + content + #""}]}"#
        XCTAssertTrue(Admission.validResult(exact))
        XCTAssertFalse(Admission.validResult(exact.replacingOccurrences(of: "local-health-context", with: "orot_health_context")))
        XCTAssertFalse(Admission.validResult(exact.replacingOccurrences(of: content, with: String(repeating: "x", count: 8192))))
    }
}
