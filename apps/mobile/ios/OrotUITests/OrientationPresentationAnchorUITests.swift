import XCTest

/// Confirms a real landscape transition updates native window geometry without dropping an in-progress route draft.
final class OrientationPresentationAnchorUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testLandscapeTransitionRetainsQuestionDraftAndSourceRoute() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "ai-feature-visit-questions",
            "-OROT_EVIDENCE_SOURCE_DUO_VISUAL_STATE", "synthetic",
            "-OROT_TEST_UI_GEOMETRY", "YES",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        XCUIDevice.shared.orientation = .portrait
        app.launch()
        defer {
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }

        let portrait = try waitForGeometry(app, after: nil, landscape: false)
        XCTAssertGreaterThan(portrait.width, 0)
        XCTAssertGreaterThan(portrait.height, portrait.width)

        try NavigationUITestConditions.openTab(app, "conversation", markers: ["rag-conversation-screen"])
        let question = UITestConditions.element(app, "rag-conversation-input")
        XCTAssertTrue(UITestConditions.exists(question) && question.isHittable)
        question.tap()
        question.typeText("source")
        tap(app, "rag-conversation-send")
        let source = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "원문 근거 열기")).firstMatch
        XCTAssertTrue(UITestConditions.exists(source))
        // A new draft belongs to the conversation while its cited source is open.
        let draft = "draft retained"
        question.tap()
        question.typeText(draft)
        XCTAssertTrue(source.exists && source.isHittable)
        source.tap()
        // The opt-in saved fixture exercises the integrated source route without user records.
        let sourceDetail = UITestConditions.element(app, "ai-feature-source-detail")
        XCTAssertTrue(UITestConditions.exists(sourceDetail))
        let sourceContent = UITestConditions.element(app, "ai-feature-source-content")
        XCTAssertTrue(UITestConditions.exists(sourceContent), app.debugDescription)
        // The citation opens on the excerpt; the next tab holds its saved source record.
        let originalExcerpt = app.staticTexts["합성 원문 기록: 측정 결과를 저장할 때 남긴 설명입니다."]
        XCTAssertTrue(originalExcerpt.exists, app.debugDescription)
        let sourceSection = UITestConditions.element(app, "ai-feature-source-section-1")
        XCTAssertTrue(sourceSection.exists && sourceSection.isHittable, app.debugDescription)
        XCTAssertEqual(sourceSection.label, "저장된 출처 2", app.debugDescription)
        sourceSection.tap()
        XCTAssertTrue(sourceSection.isSelected)
        XCTAssertTrue(app.staticTexts["합성 저장 기록"].exists, app.debugDescription)

        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = try waitForGeometry(app, after: portrait, landscape: true)
        XCTAssertGreaterThan(landscape.width, landscape.height)
        XCTAssertNotEqual(landscape.width, portrait.width)
        XCTAssertTrue(sourceDetail.exists && app.frame.contains(sourceDetail.frame), app.debugDescription)
        assertGeometryEvidence(landscape)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "landscape-source-route-window-geometry"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
        XCTAssertEqual(question.value as? String, draft, "The edited question must survive a real window-size transition")
        let selectedTab = try NavigationUITestConditions.navigationAction(app, "navigation-tab-conversation")
        XCTAssertTrue(selectedTab.control.isSelected)
    }

    @MainActor
    private func waitForGeometry(_ app: XCUIApplication, after previous: GeometryEvidence?, landscape: Bool) throws -> GeometryEvidence {
        var matched: GeometryEvidence?
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard let candidate = self.readGeometry(app), candidate.matchesUIKit,
                  previous.map({ candidate.timestamp > $0.timestamp }) ?? true,
                  (candidate.width > candidate.height) == landscape
            else { return false }
            matched = candidate
            return true
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed, "The native geometry event and committed context must match the active UIKit window")
        return try XCTUnwrap(matched)
    }

    @MainActor
    private func readGeometry(_ app: XCUIApplication) -> GeometryEvidence? {
        let marker = UITestConditions.element(app, "navigation-test-observation")
        guard marker.exists,
              let report = try? JSONSerialization.jsonObject(with: Data(UITestConditions.text(marker).utf8)) as? [String: Any],
              let reference = report["windowGeometry"] as? [String: Any],
              let referenceBounds = reference["windowBounds"] as? [String: Any],
              let referenceInsets = reference["safeAreaInsets"] as? [String: Any],
              let lifecycle = report["lifecycle"] as? [[String: Any]],
              let event = lifecycle.last(where: { $0["event"] as? String == "window-geometry" }),
              let context = lifecycle.last(where: { $0["event"] as? String == "window-geometry-context" }),
              let eventPayload = json(event["nativePayload"] as? String),
              let eventSnapshot = json(event["normalizedSnapshot"] as? String),
              let contextSnapshot = json(context["normalizedSnapshot"] as? String),
              let eventBounds = eventPayload["windowBounds"] as? [String: Any],
              let eventInsets = eventPayload["safeAreaInsets"] as? [String: Any],
              let snapshotBounds = eventSnapshot["windowBounds"] as? [String: Any],
              let contextBounds = contextSnapshot["windowBounds"] as? [String: Any],
              let contextInsets = contextSnapshot["safeAreaInsets"] as? [String: Any],
              let width = number(referenceBounds["width"]),
              let height = number(referenceBounds["height"]),
              let timestamp = number(report["atMs"])
        else { return nil }

        return GeometryEvidence(
            width: width,
            height: height,
            timestamp: timestamp,
            matchesUIKit: sameRect(referenceBounds, eventBounds)
                && sameRect(referenceBounds, snapshotBounds)
                && sameRect(referenceBounds, contextBounds)
                && sameInsets(referenceInsets, eventInsets)
                && sameInsets(referenceInsets, contextInsets),
        )
    }

    private func json(_ value: String?) -> [String: Any]? {
        guard let value, let data = value.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    private func number(_ value: Any?) -> Double? {
        (value as? NSNumber)?.doubleValue
    }

    private func sameRect(_ first: [String: Any], _ second: [String: Any]) -> Bool {
        ["x", "y", "width", "height"].allSatisfy { key in
            guard let lhs = number(first[key]), let rhs = number(second[key]) else { return false }
            return abs(lhs - rhs) <= 0.5
        }
    }

    private func sameInsets(_ first: [String: Any], _ second: [String: Any]) -> Bool {
        ["top", "right", "bottom", "left"].allSatisfy { key in
            guard let lhs = number(first[key]), let rhs = number(second[key]) else { return false }
            return abs(lhs - rhs) <= 0.5
        }
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ identifier: String) {
        let target = UITestConditions.element(app, identifier)
        XCTAssertTrue(UITestConditions.exists(target), app.debugDescription)
        XCTAssertTrue(target.isHittable, target.debugDescription)
        target.tap()
    }

    @MainActor
    private func assertGeometryEvidence(_ evidence: GeometryEvidence) {
        XCTAssertTrue(evidence.matchesUIKit, "The committed window size and safe area must match current UIKit values")
    }
}

private struct GeometryEvidence {
    let width: Double
    let height: Double
    let timestamp: Double
    let matchesUIKit: Bool
}
