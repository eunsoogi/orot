import XCTest

/// SQLCipher, graph, retained App session, safety and consent execute for every journey; only provider output is synthetic.
final class HealthReviewUITests: OrotFailFastTestCase {
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
        journey.tap("health-review-provider", towardTop: true)
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
    func testCancellationRejectsLateModelPublication() {
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
}
