import XCTest

/// Full App entry, explicit authored context and observed native controls; no precomputed service result.
@MainActor
final class HealthReviewJourney {
    let app = XCUIApplication()
    let fixture = "test-persistence-" + UUID().uuidString.lowercased()
    private var sequence = 0
    private var diagnosticLaunch = UUID()
    private var revealSequence = 0

    func launch(_ mode: String = "seed") {
        sequence = 0
        diagnosticLaunch = UUID()
        revealSequence = 0
        // Diagnostic identity is unrelated to the fixture's real source identifier and never exposes request content.
        app.launchArguments = ["-OROT_TEST_SCENARIO", "health-review", "-OROT_REVIEW_FIXTURE", fixture, "-OROT_REVIEW_MODE", mode,
                               "-OROT_TEST_FORM_OBSERVATION", diagnosticLaunch.uuidString]
        app.launch()
        UITestConditions.value(element("health-review-probe-ready"), equals: "ready")
    }

    func open() {
        tap("navigation-tab-ai", inForm: false)
        tap("ai-feature-health-review", scrollID: "ai-features-screen")
        XCTAssertTrue(UITestConditions.exists(element("health-review-screen")))
    }

    func element(_ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    func tap(_ id: String, inForm: Bool = true, scrollID: String = "health-review-screen", towardTop: Bool = false) {
        let control = element(id)
        XCTAssertTrue(UITestConditions.exists(control))
        if inForm {
            var observation: FormScrollObservation?
            if id == "health-review-start" {
                revealSequence += 1
                observation = FormScrollObservation(launch: diagnosticLaunch, reveal: revealSequence)
            }
            FormUITestConditions.reveal(control, in: app, scrollID: scrollID, towardTop: towardTop, scrollObservation: observation)
        }
        XCTAssertTrue(control.isHittable)
        control.tap()
    }

    func choose(_ label: String) {
        // React Native exposes radio controls without the iOS button trait.
        let control = element(label)
        XCTAssertTrue(UITestConditions.exists(control))
        FormUITestConditions.reveal(control, in: app, scrollID: "health-review-screen", towardTop: true)
        XCTAssertTrue(control.isHittable)
        control.tap()
    }

    func enter(_ id: String, _ text: String) {
        let input = app.textFields.matching(identifier: id).firstMatch
        XCTAssertTrue(UITestConditions.exists(input))
        XCTAssertTrue(FormUITestConditions.replace(input, with: text, in: app, scrollID: "health-review-screen"))
    }

    func name() {
        enter("health-review-name", fixture)
    }

    func sufficientSafety() {
        choose("대상 정보: 임신 중이 아닌 성인")
        choose("혈압 측정 상황: 현재 측정")
        choose("현재 증상 확인: 새롭거나 걱정되는 증상이 없음")
        reading(systolic: "120", diastolic: "80")
    }

    func reading(systolic: String, diastolic: String) {
        enter("health-review-systolic-0", systolic)
        enter("health-review-diastolic-0", diastolic)
        tap("health-review-measuredAt-0")
        pickerAction("health-review-time-done")
        enter("health-review-source-0", "사용자가 확인한 합성 혈압계")
    }

    func pickerAction(_ id: String) {
        let control = element(id)
        XCTAssertTrue(UITestConditions.exists(control))
        FormUITestConditions.reveal(control, in: app, scrollID: "health-review-time-page")
        XCTAssertTrue(control.isHittable)
        control.tap()
    }

    func status(_ id: String) {
        let text = element(id)
        XCTAssertTrue(UITestConditions.exists(text))
        FormUITestConditions.reveal(text, in: app, scrollID: "health-review-screen", towardTop: true, requireHittable: false)
        XCTAssertFalse(text.frame.isEmpty)
    }

    func report() throws -> [String: Any] {
        sequence += 1
        tap("health-review-probe-readback", inForm: false)
        let text = element("health-review-probe-report")
        let loaded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "\"readback\":\(sequence),"), object: text)
        XCTAssertEqual(UITestConditions.wait(for: [loaded]), .completed)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(UITestConditions.text(text).utf8)) as? [String: Any])
    }

    func selectPending() {
        let button = app.buttons.matching(identifier: fixture + ": 추가 정보 대기").firstMatch
        XCTAssertTrue(UITestConditions.exists(button))
        FormUITestConditions.reveal(button, in: app, scrollID: "health-review-screen")
        XCTAssertTrue(button.isHittable)
        button.tap()
    }

    func deleteRequest() {
        let button = app.buttons.matching(identifier: fixture + ": 검토 요청 삭제").firstMatch
        XCTAssertTrue(UITestConditions.exists(button))
        FormUITestConditions.reveal(button, in: app, scrollID: "health-review-screen")
        XCTAssertTrue(button.isHittable)
        button.tap()
        let confirm = app.alerts.buttons["검토 요청 삭제"]
        XCTAssertTrue(UITestConditions.exists(confirm))
        XCTAssertTrue(confirm.isHittable)
        confirm.tap()
    }

    func clean() {
        XCUIDevice.shared.orientation = .portrait
        tap("health-review-probe-cleanup", inForm: false)
        UITestConditions.value(element("health-review-probe-report"), equals: "cleaned")
        app.terminate()
    }
}
