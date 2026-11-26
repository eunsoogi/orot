import Foundation
@testable import Orot
import XCTest

extension RealtimeVoiceLifecycleTests {
    func assertCanonicalGrantRequiresItsOwnCurrentDeviceBindingAndLegacyOwner() throws {
        typealias Admission = RealtimeVoiceCanonicalHealthAdmission
        XCTAssertTrue(Admission.enabledForLiveBridge)
        XCTAssertTrue(Admission.permitsStartupOptions(["responsesGrant": ["fixture": true]]))
        for raw in [["canonicalHealthGrant": NSNull()], ["canonicalHealthDeclaration": NSNull()],
                    ["canonicalHealthGrant": NSNull(), "canonicalHealthDeclaration": NSNull()]]
        {
            XCTAssertFalse(Admission.permitsStartupOptions(raw as NSDictionary, enabled: false))
            XCTAssertTrue(Admission.permitsStartupOptions(raw as NSDictionary))
        }
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
        try assertAggregateV2ScopeWitness(readBase: read, generation: legacy, credential: credential)
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
        var another = companion
        another["backendModel"] = "gpt-6-luna"
        let mismatched = try XCTUnwrap(Admission(another))
        try assertNativeReviewIsExactFreshAndSingleUse(grant, mismatched: mismatched)
        try assertNativePresenterOnlyIssuesFromItsVisibleDecision(grant)
    }

    private func assertAggregateV2ScopeWitness(
        readBase: (String, String) -> [String: Any]?, generation: String, credential: String,
    ) throws {
        let scope = "selected-live-heart-rate-aggregate-v2"
        let input = ["backendModel": "gpt-6-sol", "generation": generation, "grantID": generation + "-model"]
        let legacy = try XCTUnwrap(LiveResponsesSettingsGrant(input))
        let upgraded = try XCTUnwrap(LiveResponsesSettingsGrant(input.merging(["scope": scope]) { $1 }))
        var marker: [String: Any]?
        let read: (String, String) -> [String: Any]? = { service, account in
            if service == "com.orot.mobile.live-aggregate-policy.v2." + generation, account == "live-aggregate-policy" {
                return marker
            }
            return readBase(service, account)
        }
        XCTAssertTrue(legacy.isCurrent(key: "synthetic-test-only", read: read))
        XCTAssertFalse(upgraded.isCurrent(key: "synthetic-test-only", read: read))
        marker = [
            "scope": scope, "providerId": "openai-live-responses", "recipient": "OpenAI Responses (Live)",
            "backendModel": "gpt-6-sol", "grantID": generation + "-model", "generation": generation, "credentialEpoch": credential,
        ]
        XCTAssertTrue(upgraded.isCurrent(key: "synthetic-test-only", read: read))
        marker?["recipient"] = "Another recipient"
        XCTAssertFalse(upgraded.isCurrent(key: "synthetic-test-only", read: read))
        XCTAssertNil(LiveResponsesSettingsGrant(input.merging(["scope": "something-else"]) { $1 }))
    }

    private func assertNativeReviewIsExactFreshAndSingleUse(
        _ grant: RealtimeVoiceCanonicalHealthAdmission, mismatched: RealtimeVoiceCanonicalHealthAdmission,
    ) throws {
        var tick: TimeInterval = 1
        var nativeCurrent = true
        let review = CanonicalLiveNativeCallReview(now: { tick })
        let first = CanonicalLiveNativeCallReview.Scope(call: "first", capability: grant)
        let second = CanonicalLiveNativeCallReview.Scope(call: "second", capability: grant)
        func begin() throws -> ((Bool) -> Void) {
            try XCTUnwrap(review.begin(first, current: { nativeCurrent }))
        }
        func consume(_ scope: CanonicalLiveNativeCallReview.Scope) -> Bool {
            review.consume(scope, current: { nativeCurrent })
        }
        XCTAssertFalse(consume(first))
        try begin()(false)
        XCTAssertFalse(consume(first))
        try begin()(true)
        XCTAssertFalse(consume(second))
        XCTAssertFalse(consume(first))
        try begin()(true)
        XCTAssertFalse(consume(.init(call: first.call, capability: mismatched)))
        XCTAssertFalse(consume(first))
        let old = try begin()
        let fresh = try begin()
        old(true)
        XCTAssertFalse(consume(first))
        fresh(true)
        XCTAssertTrue(consume(first))
        XCTAssertFalse(consume(first))
        let abandoned = try begin()
        review.retire(first.call)
        abandoned(true)
        XCTAssertFalse(consume(first))
        try begin()(true)
        tick += 30
        XCTAssertFalse(consume(first))
        let expiredReview = try begin()
        tick += 30
        expiredReview(true)
        XCTAssertFalse(consume(first))
        try begin()(true)
        nativeCurrent = false
        XCTAssertFalse(consume(first))
    }

    private func assertNativePresenterOnlyIssuesFromItsVisibleDecision(_ grant: RealtimeVoiceCanonicalHealthAdmission) throws {
        let scope = CanonicalLiveCallPresenter.Scope(call: "synthetic-call", capability: grant)
        var tapped: CanonicalLiveCallPresenter.Decision?
        var focused = true
        var owner = true
        var dismissed = 0
        let review = CanonicalLiveCallPresenter(available: { focused }, show: { shown, decision in
            XCTAssertEqual(shown, scope)
            tapped = decision
            return { dismissed += 1 }
        })
        var output: [Bool?] = []
        func begin() {
            review.begin(scope, current: { owner }, decide: { output.append($0) })
        }
        begin()
        XCTAssertFalse(review.consume(scope))
        try XCTUnwrap(tapped)(false)
        XCTAssertEqual(output, [false])
        XCTAssertFalse(review.consume(scope))
        begin()
        let late = try XCTUnwrap(tapped)
        review.retire(scope.call)
        late(true)
        XCTAssertEqual(output, [false, nil])
        XCTAssertEqual(dismissed, 1)
        XCTAssertFalse(review.consume(scope))
        begin()
        focused = false
        try XCTUnwrap(tapped)(true)
        XCTAssertFalse(review.consume(scope))
        focused = true
        begin()
        owner = false
        try XCTUnwrap(tapped)(true)
        XCTAssertFalse(review.consume(scope))
        owner = true
        begin()
        try XCTUnwrap(tapped)(true)
        XCTAssertEqual(output, [false, nil, nil, nil, true])
        XCTAssertTrue(review.consume(scope))
        XCTAssertFalse(review.consume(scope))
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
