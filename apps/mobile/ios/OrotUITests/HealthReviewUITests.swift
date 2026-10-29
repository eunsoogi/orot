import XCTest

/// SQLCipher, graph, retained App session, safety and consent execute for every journey; only provider output is synthetic.
final class HealthReviewUITests: OrotFailFastTestCase {
    @MainActor
    func testMeasurementTimeCancelAndReopenPreserveInput() {
        let journey = HealthReviewJourney()
        defer { journey.clean() }
        journey.launch()
        journey.open()
        journey.name()
        journey.tap("health-review-measuredAt-0")
        journey.tap("health-review-time-done", inForm: false)
        let time = journey.element("health-review-measuredAt-0")
        let committed = time.value as? String
        XCTAssertNotNil(committed)
        journey.tap("health-review-measuredAt-0")
        journey.tap("health-review-time-cancel", inForm: false)
        XCTAssertEqual(time.value as? String, committed)
        XCTAssertEqual(journey.app.textFields["health-review-name"].value as? String, journey.fixture)
    }

    @MainActor
    func testHealthKitReviewCitationReturnRetainsSession() throws {
        let journey = HealthReviewJourney()
        defer { journey.clean() }
        journey.launch()
        journey.open()
        journey.name()
        journey.sufficientSafety()
        journey.tap("health-review-start")
        journey.status("health-review-result")
        XCTAssertEqual(try journey.report()["modelCalls"] as? Int, 1)
        journey.tap("health-review-citation-e1", towardTop: true)
        XCTAssertTrue(UITestConditions.exists(journey.element("ai-feature-source-detail")))
        journey.tap("navigation-back", inForm: false)
        journey.status("health-review-result")
        journey.tap("ai-feature-select-provider", towardTop: true)
        journey.tap("navigation-back", inForm: false)
        journey.status("health-review-result")
        XCTAssertEqual(journey.app.textFields["health-review-name"].value as? String, journey.fixture)
        XCTAssertEqual(try journey.report()["modelCalls"] as? Int, 1)
    }

    @MainActor
    func testPendingRestoresAcrossFreshProcessWithoutAutomaticInference() throws {
        let journey = HealthReviewJourney()
        defer { journey.clean() }
        journey.launch()
        journey.open()
        journey.name()
        journey.tap("health-review-start")
        journey.status("health-review-needs_clarification")
        XCTAssertEqual(try journey.report()["pending"] as? Int, 1)
        XCTAssertEqual(try journey.report()["modelCalls"] as? Int, 0)
        journey.choose("대상 정보: 임신 중이 아닌 성인")
        let selectedPopulation = journey.app.buttons.matching(identifier: "대상 정보: 임신 중이 아닌 성인").firstMatch
        XCTAssertTrue(selectedPopulation.isSelected)
        // Reflow must preserve the selected answer and saved interrupt without starting inference.
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertEqual(journey.app.textFields["health-review-name"].value as? String, journey.fixture)
        XCTAssertTrue(selectedPopulation.isSelected)
        journey.status("health-review-needs_clarification")
        XCTAssertEqual(try journey.report()["pending"] as? Int, 1)
        XCTAssertEqual(try journey.report()["modelCalls"] as? Int, 0)
        XCUIDevice.shared.orientation = .portrait
        journey.app.terminate()
        journey.launch("restore")
        journey.open()
        journey.selectPending()
        journey.status("health-review-needs_clarification")
        XCTAssertEqual(try journey.report()["modelCalls"] as? Int, 0)
        XCTAssertFalse(journey.element("health-review-result").exists)
    }

    @MainActor
    func testExplicitClarificationContinuesExactPendingReview() throws {
        let journey = HealthReviewJourney()
        defer { journey.clean() }
        journey.launch()
        journey.open()
        journey.name()
        journey.tap("health-review-start")
        journey.status("health-review-needs_clarification")
        journey.sufficientSafety()
        journey.tap("health-review-continue")
        journey.status("health-review-result")
        XCTAssertEqual(try journey.report()["modelCalls"] as? Int, 1)
        XCTAssertEqual(try journey.report()["pending"] as? Int, 0)
    }

    @MainActor
    func testUnknownSymptomsShowsEveryRequiredActionBeforeInference() throws {
        let journey = HealthReviewJourney()
        defer { journey.clean() }
        journey.launch()
        journey.open()
        journey.name()
        journey.choose("대상 정보: 임신 중이 아닌 성인")
        journey.choose("혈압 측정 상황: 현재 측정")
        journey.reading(systolic: "190", diastolic: "125")
        journey.tap("health-review-start")
        journey.status("health-review-needs_clarification")
        for label in ["위험 증상과 새롭거나 걱정되는 증상이 있는지 확인해 주세요.", "위험 증상이 있다면 즉시 응급 서비스에 연락하세요."] {
            let action = journey.app.staticTexts[label]
            XCTAssertTrue(UITestConditions.exists(action))
            FormUITestConditions.reveal(action, in: journey.app, scrollID: "health-review-screen", towardTop: true, requireHittable: false)
            XCTAssertFalse(action.frame.isEmpty)
        }
        XCTAssertEqual(try journey.report()["modelCalls"] as? Int, 0)
    }

    @MainActor
    func testDeniedRemoteConsentSendsNoModelRequest() throws {
        let journey = HealthReviewJourney()
        defer { journey.clean() }
        journey.launch("remote")
        journey.open()
        journey.name()
        journey.sufficientSafety()
        journey.tap("health-review-start")
        journey.tap("inference-disclosure-cancel", inForm: false)
        journey.status("health-review-consent-denied")
        XCTAssertEqual(try journey.report()["modelCalls"] as? Int, 0)
    }

    @MainActor
    func testCancellationRejectsLateModelPublication() throws {
        try verifyIncompleteObservationBinding()
        let journey = HealthReviewJourney()
        defer { journey.clean() }
        journey.launch("waiting")
        journey.open()
        journey.name()
        journey.sufficientSafety()
        journey.tap("health-review-start")
        journey.tap("health-review-cancel")
        journey.status("health-review-cancelled")
        XCTAssertFalse(journey.element("health-review-result").exists)
    }

    @MainActor
    func testChangedEvidenceCitationAndRequestDeletionPreserveImportedRecords() throws {
        let journey = HealthReviewJourney()
        defer { journey.clean() }
        journey.launch()
        journey.open()
        journey.name()
        journey.sufficientSafety()
        journey.tap("health-review-start")
        journey.status("health-review-result")
        journey.deleteRequest()
        XCTAssertEqual(try journey.report()["requests"] as? Int, 0)
        XCTAssertEqual(try journey.report()["observationPresent"] as? Bool, true)
        journey.tap("health-review-start")
        journey.status("health-review-result")
        journey.tap("health-review-probe-remove-observation", inForm: false)
        UITestConditions.value(journey.element("health-review-probe-report"), equals: "observation-removed")
        journey.tap("health-review-citation-e1", towardTop: true)
        XCTAssertTrue(UITestConditions.exists(journey.element("ai-feature-source-changed")))
    }

    /// Decode the exported envelope shape on the native XCTest target; unavailable post geometry cannot prove a gesture.
    private func verifyIncompleteObservationBinding() throws {
        let launch = UUID()
        let before = FormScrollObservation.Record(launch: launch, reveal: 1, step: 1, phase: .before,
                                                  uptime: 100, target: nil, start: [20, 50], end: [20, 10])
        let after = FormScrollObservation.Record(launch: launch, reveal: 1, step: 1, phase: .after,
                                                 uptime: 110, target: nil, start: [20, 50], end: [20, 10])
        func touch(_ phase: String, loss: String? = nil, missing: Bool = false) throws -> FormScrollObservation.Touch {
            let began = phase == "began"
            var value: [String: Any] = ["launch": launch.uuidString, "sequence": began ? 1 : 2, "touch": 1,
                                        "phase": phase, "touchUptime": began ? 101 : 108, "capturedUptime": began ? 102 : 109,
                                        "point": [20, began ? 50 : 10], "touchCount": 1, "multipleTouches": false,
                                        "trackingDiscarded": 0, "losses": loss.map { [$0] } ?? []]
            if !missing {
                value["geometry"] = ["truncated": false, "startMatches": 1]
            }
            return try JSONDecoder().decode(FormScrollObservation.Touch.self, from: JSONSerialization.data(withJSONObject: value))
        }
        let began = try touch("began")
        XCTAssertEqual(try FormScrollObservation.bind([began, touch("ended")], dropped: 0, before: before, after: after), 1)
        for loss in ["formMissing", "formAmbiguous", "receiverMissing", "receiverOutsideForm", "trackingMissing", "trackingOverflow", "traversalLimit"] {
            XCTAssertNil(try FormScrollObservation.bind([began, touch("ended", loss: loss, missing: true)], dropped: 0, before: before, after: after))
            XCTAssertNil(try FormScrollObservation.bind([began, touch("ended", loss: loss)], dropped: 0, before: before, after: after))
        }
        XCTAssertNil(FormScrollObservation.bind([began], dropped: 0, before: before, after: after))
        XCTAssertNil(try FormScrollObservation.bind([began, touch("ended", missing: true)], dropped: 0, before: before, after: after))
    }
}
