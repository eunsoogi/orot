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

        try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])
        tap(app, "ai-feature-visit-questions")
        NavigationUITestConditions.route(app, markers: ["next-visit-questions-scroll"])
        try NavigationUITestConditions.tapNavigation(app, "next-visit-generate")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "next-visit-review-save")))

        let question = FormUITestConditions.multilineInput(app, identifier: "next-visit-question-text-0")
        let draft = "합성 초안 유지"
        XCTAssertTrue(FormUITestConditions.replace(question, with: draft, in: app, scrollID: "next-visit-questions-scroll"))

        let source = UITestConditions.element(app, "next-visit-source-0-0")
        FormUITestConditions.reveal(source, in: app, scrollID: "next-visit-questions-scroll", avoiding: question)
        XCTAssertTrue(source.exists && source.isHittable)
        source.tap()
        let sourceDetail = UITestConditions.element(app, "next-visit-source-content")
        XCTAssertTrue(UITestConditions.exists(sourceDetail))

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

        tap(app, "next-visit-source-close")
        NavigationUITestConditions.route(app, markers: ["next-visit-questions-scroll"])
        XCTAssertEqual(question.value as? String, draft, "The edited question must survive a real window-size transition")
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
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
