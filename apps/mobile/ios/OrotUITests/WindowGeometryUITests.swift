import XCTest

/// Verifies the live native geometry bridge and retained navigation draft using public UI state.
final class WindowGeometryUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testIPhoneGeometryEventsMatchUIKitAndRetainQuestionDraftAcrossSourceNavigation() throws {
        try runGeometryBridgeAndRetainQuestionDraftAcrossSourceNavigation()
    }

    @MainActor
    func testDuoGeometryEventsMatchUIKitAndRetainQuestionDraftAcrossSourceNavigation() throws {
        try runGeometryBridgeAndRetainQuestionDraftAcrossSourceNavigation(verifyAdaptiveReflow: true)
    }

    /// Separate profile identifiers keep iPhone and Duo results distinct while sharing one route journey.
    @MainActor
    private func runGeometryBridgeAndRetainQuestionDraftAcrossSourceNavigation(verifyAdaptiveReflow: Bool = false) throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "ai-feature-visit-questions",
            "-OROT_TEST_UI_GEOMETRY", "YES",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        defer { app.terminate() }

        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "welcome-title")))
        try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])
        let rootRoute = try XCTUnwrap(waitForGeometry(app).adaptive.routeKey)
        NavigationWindowGeometryUITestConditions.tap(app, "ai-feature-visit-questions")
        NavigationUITestConditions.route(app, markers: ["next-visit-questions-scroll"])
        let generate = UITestConditions.element(app, "next-visit-generate")
        _ = try XCTUnwrap(FormUITestConditions.reveal(generate, in: app, scrollID: "next-visit-questions-scroll"))
        XCTAssertTrue(generate.exists && generate.isHittable)
        guard generate.exists, generate.isHittable else { return }
        generate.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "next-visit-review-save")))

        let question = FormUITestConditions.multilineInput(app, identifier: "next-visit-question-text-0")
        let draft = "합성 초안 유지"
        XCTAssertTrue(FormUITestConditions.replace(question, with: draft, in: app, scrollID: "next-visit-questions-scroll"))

        let source = UITestConditions.element(app, "next-visit-source-0-0")
        FormUITestConditions.reveal(
            source,
            in: app,
            scrollID: "next-visit-questions-scroll",
            avoiding: question,
        )
        XCTAssertTrue(source.exists && source.isHittable)
        source.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "next-visit-source-content")))
        NavigationWindowGeometryUITestConditions.tap(app, "next-visit-source-close")
        NavigationUITestConditions.route(app, markers: ["next-visit-questions-scroll"])
        let questionRoute = try XCTUnwrap(waitForGeometry(app, routeKeyDifferentFrom: rootRoute).adaptive.routeKey)

        if verifyAdaptiveReflow {
            // The Duo run follows UIKit orientation events without synthesizing geometry.
            defer { XCUIDevice.shared.orientation = .portrait }
            let before = try waitForGeometry(app)
            XCUIDevice.shared.orientation = .landscapeLeft
            let landscape = try waitForGeometry(app, widthDifferentFrom: before.publicUIKit.windowBounds.width, routeWidthDifferentFrom: before.adaptive.width)
            XCTAssertTrue(landscape.adaptive.routeKey == questionRoute && landscape.adaptive.columns == 2 && (question.value as? String) == draft)
            XCUIDevice.shared.orientation = .portrait
            let portrait = try waitForGeometry(app, widthDifferentFrom: landscape.publicUIKit.windowBounds.width, routeWidthDifferentFrom: landscape.adaptive.width)
            XCTAssertTrue(portrait.adaptive.routeKey == questionRoute && (question.value as? String) == draft)
        }

        try assertGeometry(waitForGeometry(app))
        try NavigationWindowGeometryUITestConditions.verifyObservedSplit(app, testCase: self)
        XCTAssertTrue((question.value as? String) == draft, "The edited question must survive the source-detail route")
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
        if verifyAdaptiveReflow {
            let returned = try waitForGeometry(app, routeKeyDifferentFrom: questionRoute)
            XCTAssertEqual(returned.adaptive.routeKey, rootRoute)
        }
    }

    @MainActor
    private func waitForGeometry(_ app: XCUIApplication, widthDifferentFrom previousWidth: Double? = nil,
                                 routeWidthDifferentFrom previousRouteWidth: Double? = nil,
                                 routeKeyDifferentFrom previousRouteKey: String? = nil) throws -> GeometryReceipt
    {
        // Wait for the actual event, committed context and independent UIKit snapshot to agree.
        var receipt: GeometryReceipt?
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            receipt = self.readGeometry(app)
            let widthChanged = previousWidth.map { abs((receipt?.publicUIKit.windowBounds.width ?? $0) - $0) > 0.5 } ?? true
            let routeWidthChanged = previousRouteWidth.map { abs((receipt?.adaptive.width ?? $0) - $0) > 0.5 } ?? true
            let routeChanged = previousRouteKey.map { receipt?.adaptive.routeKey != $0 } ?? true
            return receipt?.matchesPublicUIKit == true && widthChanged && routeWidthChanged && routeChanged
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed, "The native sensor event and RN context must match current UIKit geometry")
        return try XCTUnwrap(receipt)
    }

    @MainActor
    private func readGeometry(_ app: XCUIApplication) -> GeometryReceipt? {
        // Extract only geometry fields from the existing test bridge; do not attach draft or route text.
        let marker = UITestConditions.element(app, "navigation-test-observation")
        guard marker.exists,
              let observation = try? JSONSerialization.jsonObject(with: Data(UITestConditions.text(marker).utf8)) as? [String: Any],
              let reference = observation["windowGeometry"] as? [String: Any],
              let lifecycle = observation["lifecycle"] as? [[String: Any]],
              let event = lifecycle.last(where: { $0["event"] as? String == "window-geometry" }),
              let context = lifecycle.last(where: { $0["event"] as? String == "window-geometry-context" }),
              let eventJSON = event["nativePayload"] as? String,
              let eventSnapshotJSON = event["normalizedSnapshot"] as? String,
              let contextSnapshotJSON = context["normalizedSnapshot"] as? String,
              let adaptive = lifecycle.last(where: { $0["event"] as? String == "adaptive-columns-layout" && $0["active"] as? Bool == true }),
              let adaptiveRouteKey = adaptive["routeKey"] as? String,
              let adaptiveWidth = (adaptive["width"] as? String).flatMap(Double.init),
              let adaptiveColumns = (adaptive["columns"] as? String).flatMap(Int.init),
              let referenceData = try? JSONSerialization.data(withJSONObject: reference),
              let native = try? JSONDecoder().decode(GeometryPayload.self, from: Data(eventJSON.utf8)),
              let eventSnapshot = try? JSONDecoder().decode(GeometrySnapshot.self, from: Data(eventSnapshotJSON.utf8)),
              let contextSnapshot = try? JSONDecoder().decode(GeometrySnapshot.self, from: Data(contextSnapshotJSON.utf8)),
              let publicUIKit = try? JSONDecoder().decode(GeometryPayload.self, from: referenceData)
        else {
            return nil
        }
        return GeometryReceipt(native: native, eventSnapshot: eventSnapshot, contextSnapshot: contextSnapshot, publicUIKit: publicUIKit, adaptive: (routeKey: adaptiveRouteKey, width: adaptiveWidth, columns: adaptiveColumns))
    }

    private func assertGeometry(_ receipt: GeometryReceipt) {
        // Active UIKit reservations must not overlap the provider's usable content rectangles.
        XCTAssertTrue(receipt.native.matches(receipt.publicUIKit), "The RN native event must match public UIKit window bounds and all four insets")
        XCTAssertTrue(receipt.eventSnapshot.payload.matches(receipt.publicUIKit), "The native callback must normalize the received geometry")
        XCTAssertTrue(receipt.contextSnapshot.payload.matches(receipt.publicUIKit), "The provider context must retain the normalized native geometry")
        XCTAssertTrue(rectMatches(receipt.contextSnapshot.safeAreaFrame, receipt.expectedSafeAreaFrame))
        XCTAssertTrue(receipt.contextSnapshot.reservedRegionsSupported == receipt.publicUIKit.reservedRegionsSupported)
        XCTAssertTrue(regionsMatch(receipt.contextSnapshot.reservedRegions, receipt.publicUIKit.reservedRegions))
        for region in receipt.contextSnapshot.reservedRegions where region.isActive {
            for usable in receipt.contextSnapshot.usableRegions {
                XCTAssertFalse(cgRect(region.frame).intersects(cgRect(usable)), "Active reserved regions must be absent from usable content rectangles")
            }
        }
    }
}

private struct GeometryReceipt {
    let native: GeometryPayload
    let eventSnapshot: GeometrySnapshot
    let contextSnapshot: GeometrySnapshot
    let publicUIKit: GeometryPayload
    let adaptive: (routeKey: String, width: Double, columns: Int)

    var matchesPublicUIKit: Bool {
        native.matches(publicUIKit)
            && eventSnapshot.payload.matches(publicUIKit)
            && contextSnapshot.payload.matches(publicUIKit)
            && rectMatches(contextSnapshot.safeAreaFrame, expectedSafeAreaFrame)
    }

    var expectedSafeAreaFrame: GeometryRect {
        GeometryRect(
            x: publicUIKit.windowBounds.x + publicUIKit.safeAreaInsets.left,
            y: publicUIKit.windowBounds.y + publicUIKit.safeAreaInsets.top,
            width: max(0, publicUIKit.windowBounds.width - publicUIKit.safeAreaInsets.left - publicUIKit.safeAreaInsets.right),
            height: max(0, publicUIKit.windowBounds.height - publicUIKit.safeAreaInsets.top - publicUIKit.safeAreaInsets.bottom),
        )
    }
}

private struct GeometrySnapshot: Decodable {
    let windowBounds: GeometryRect
    let safeAreaInsets: GeometryInsets
    let reservedRegionsSupported: Bool
    let reservedRegions: [GeometryRegion]
    let safeAreaFrame: GeometryRect
    let usableRegions: [GeometryRect]

    var payload: GeometryPayload {
        GeometryPayload(windowBounds: windowBounds, safeAreaInsets: safeAreaInsets, reservedRegionsSupported: reservedRegionsSupported, reservedRegions: reservedRegions)
    }
}

private struct GeometryPayload: Decodable {
    let windowBounds: GeometryRect
    let safeAreaInsets: GeometryInsets
    let reservedRegionsSupported: Bool
    let reservedRegions: [GeometryRegion]

    func matches(_ other: GeometryPayload) -> Bool {
        rectMatches(windowBounds, other.windowBounds)
            && insetsMatch(safeAreaInsets, other.safeAreaInsets)
            && reservedRegionsSupported == other.reservedRegionsSupported
            && regionsMatch(reservedRegions, other.reservedRegions)
    }
}

private struct GeometryRect: Decodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

private struct GeometryInsets: Decodable {
    let top: Double
    let right: Double
    let bottom: Double
    let left: Double
}

private struct GeometryRegion: Decodable {
    let id: String
    let kind: String
    let frame: GeometryRect
    let margins: GeometryInsets
    let isActive: Bool
}

private func rectMatches(_ first: GeometryRect, _ second: GeometryRect) -> Bool {
    abs(first.x - second.x) <= 0.5
        && abs(first.y - second.y) <= 0.5
        && abs(first.width - second.width) <= 0.5
        && abs(first.height - second.height) <= 0.5
}

private func insetsMatch(_ first: GeometryInsets, _ second: GeometryInsets) -> Bool {
    abs(first.top - second.top) <= 0.5
        && abs(first.right - second.right) <= 0.5
        && abs(first.bottom - second.bottom) <= 0.5
        && abs(first.left - second.left) <= 0.5
}

private func regionsMatch(_ first: [GeometryRegion], _ second: [GeometryRegion]) -> Bool {
    guard first.count == second.count else { return false }
    return first.allSatisfy { region in
        guard let match = second.first(where: { $0.id == region.id && $0.kind == region.kind }) else { return false }
        return region.isActive == match.isActive
            && rectMatches(region.frame, match.frame)
            && insetsMatch(region.margins, match.margins)
    }
}

private func cgRect(_ rect: GeometryRect) -> CGRect {
    CGRect(x: rect.x, y: rect.y, width: rect.width, height: rect.height)
}
