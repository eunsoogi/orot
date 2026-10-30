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
        let inputObservation = ProcessInfo.processInfo.environment["OROT_TEST_ENCOUNTER_INPUT_OBSERVATION"] == "1"
            ? EncounterInputObservation()
            : nil
        var launchArguments = [
            "-OROT_TEST_SCENARIO", "ai-feature-visit-questions",
            "-OROT_EVIDENCE_SOURCE_DUO_VISUAL_STATE", "synthetic",
            "-OROT_TEST_UI_GEOMETRY", "YES",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        // Share one run ID across runner brackets and UIKit snapshots only for an explicit diagnostic run.
        if let inputObservation {
            launchArguments += ["-OROT_TEST_ENCOUNTER_INPUT_OBSERVATION", inputObservation.run.uuidString]
        }
        app.launchArguments = launchArguments
        app.launch()
        defer { app.terminate() }

        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "welcome-title")))
        try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])
        // The selected tab and visible screen marker identify this screen-owned root without a scene adaptive event.
        let rootTab = try NavigationUITestConditions.navigationAction(app, "navigation-tab-ai")
        XCTAssertTrue(rootTab.control.isSelected)
        let root = try waitForGeometry(app, requiresAdaptiveLayout: false)
        NavigationWindowGeometryUITestConditions.assertGeometry(root)
        let rootRouteKey = root.routeKey
        let rootFrame = try NavigationGeometryUITestConditions.captureBoundary(
            app, navigationID: "navigation-tab-ai", name: "ai-root-content-and-rail", testCase: self,
        )
        NavigationWindowGeometryUITestConditions.tap(app, "ai-feature-visit-questions")
        NavigationUITestConditions.route(app, markers: ["next-visit-questions-scroll"])
        let questionGeometry = try waitForGeometry(app)
        let questionLayout = try XCTUnwrap(questionGeometry.adaptive)
        let questionRoute = questionGeometry.routeKey
        XCTAssertNotEqual(questionRoute, rootRouteKey, "Pushing the questions screen must change the active route")
        XCTAssertEqual(questionLayout.routeKey, questionRoute, "Adaptive geometry must belong to the active questions route")
        XCTAssertEqual(questionLayout.columns, 1, "The visit questions screen keeps its current single-column layout")
        NavigationWindowGeometryUITestConditions.assertGeometry(questionGeometry)
        let generate = UITestConditions.element(app, "next-visit-generate")
        _ = try XCTUnwrap(FormUITestConditions.reveal(generate, in: app, scrollID: "next-visit-questions-scroll"))
        XCTAssertTrue(generate.exists && generate.isHittable)
        guard generate.exists, generate.isHittable else { return }
        generate.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "next-visit-review-save")))

        let question = FormUITestConditions.multilineInput(app, identifier: "next-visit-question-text-0")
        let draft = "합성 초안 유지"
        XCTAssertTrue(FormUITestConditions.replace(
            question,
            with: draft,
            in: app,
            scrollID: "next-visit-questions-scroll",
            observeInput: inputObservation?.record,
        ))

        let source = UITestConditions.element(app, "next-visit-source-0-0")
        FormUITestConditions.reveal(
            source,
            in: app,
            scrollID: "next-visit-questions-scroll",
            avoiding: question,
        )
        XCTAssertTrue(source.exists && source.isHittable)
        source.tap()
        // The opt-in saved fixture exercises the integrated source route without user records.
        let sourceDetail = UITestConditions.element(app, "ai-feature-source-detail")
        XCTAssertTrue(UITestConditions.exists(sourceDetail))
        let sourceContent = UITestConditions.element(app, "ai-feature-source-content")
        XCTAssertTrue(UITestConditions.exists(sourceContent), app.debugDescription)
        // The persisted fixture places the excerpt after its saved source record.
        let excerptSection = UITestConditions.element(app, "ai-feature-source-section-1")
        XCTAssertTrue(excerptSection.exists && excerptSection.isHittable, app.debugDescription)
        XCTAssertEqual(excerptSection.label, "원문 발췌 2", app.debugDescription)
        excerptSection.tap()
        let originalExcerpt = app.staticTexts["합성 원문 기록: 측정 결과를 저장할 때 남긴 설명입니다."]
        XCTAssertTrue(originalExcerpt.exists, app.debugDescription)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["next-visit-questions-scroll"])
        let restoredQuestion = try waitForGeometry(app, routeKey: questionRoute)
        NavigationWindowGeometryUITestConditions.assertGeometry(restoredQuestion)

        if verifyAdaptiveReflow {
            // The Duo run follows UIKit orientation events without synthesizing geometry.
            defer { XCUIDevice.shared.orientation = .portrait }
            let before = try waitForGeometry(app, routeKey: questionRoute)
            let beforeLayout = try XCTUnwrap(before.adaptive)
            XCUIDevice.shared.orientation = .landscapeLeft
            let landscape = try waitForGeometry(
                app, widthDifferentFrom: before.publicUIKit.windowBounds.width,
                routeWidthDifferentFrom: beforeLayout.width, routeKey: questionRoute,
            )
            let landscapeLayout = try XCTUnwrap(landscape.adaptive)
            XCTAssertTrue(landscapeLayout.routeKey == questionRoute && landscapeLayout.columns == 1 && (question.value as? String) == draft)
            XCUIDevice.shared.orientation = .portrait
            let portrait = try waitForGeometry(
                app, widthDifferentFrom: landscape.publicUIKit.windowBounds.width,
                routeWidthDifferentFrom: landscapeLayout.width, routeKey: questionRoute,
            )
            let portraitLayout = try XCTUnwrap(portrait.adaptive)
            XCTAssertTrue(portraitLayout.routeKey == questionRoute && portraitLayout.columns == 1 && (question.value as? String) == draft)
        }

        let finalQuestion = try waitForGeometry(app, routeKey: questionRoute)
        NavigationWindowGeometryUITestConditions.assertGeometry(finalQuestion)
        let contextualFrame = try NavigationGeometryUITestConditions.captureBoundary(
            app, navigationID: "navigation-back", name: "question-content-and-rail", testCase: self,
        )
        NavigationGeometryUITestConditions.assertSameRailCenter(rootFrame, contextualFrames: [contextualFrame])
        try NavigationWindowGeometryUITestConditions.verifyObservedSplit(app, testCase: self)
        XCTAssertTrue((question.value as? String) == draft, "The edited question must survive the source-detail route")
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
        let returnedRootTab = try NavigationUITestConditions.navigationAction(app, "navigation-tab-ai")
        XCTAssertTrue(returnedRootTab.control.isSelected)
        let returnedRoot = try waitForGeometry(app, routeKey: rootRouteKey, requiresAdaptiveLayout: false)
        NavigationWindowGeometryUITestConditions.assertGeometry(returnedRoot)
        let returnedRootFrame = try NavigationGeometryUITestConditions.captureBoundary(
            app, navigationID: "navigation-tab-ai", name: "returned-ai-root-content-and-rail", testCase: self,
        )
        NavigationGeometryUITestConditions.assertSameRailCenter(rootFrame, contextualFrames: [contextualFrame, returnedRootFrame])
    }

    @MainActor
    private func waitForGeometry(_ app: XCUIApplication, widthDifferentFrom previousWidth: Double? = nil,
                                 routeWidthDifferentFrom previousRouteWidth: Double? = nil,
                                 routeKey: String? = nil,
                                 requiresAdaptiveLayout: Bool = true) throws -> NavigationWindowGeometryUITestConditions.GeometryReceipt
    {
        // Scene-owned layouts publish adaptive measurements; screen-owned roots rely on native and shared frames.
        var receipt: NavigationWindowGeometryUITestConditions.GeometryReceipt?
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            receipt = self.readGeometry(app, requiresAdaptiveLayout: requiresAdaptiveLayout)
            let widthChanged = previousWidth.map { abs((receipt?.publicUIKit.windowBounds.width ?? $0) - $0) > 0.5 } ?? true
            let routeWidthChanged = previousRouteWidth.map { abs((receipt?.adaptive?.width ?? $0) - $0) > 0.5 } ?? true
            let routeMatches = routeKey.map {
                receipt?.routeKey == $0 && (!requiresAdaptiveLayout || receipt?.adaptive?.routeKey == $0)
            } ?? true
            return receipt?.matchesPublicUIKit == true && widthChanged && routeWidthChanged && routeMatches
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed, "The native sensor event and RN context must match current UIKit geometry")
        return try XCTUnwrap(receipt)
    }

    @MainActor
    private func readGeometry(_ app: XCUIApplication, requiresAdaptiveLayout: Bool) -> NavigationWindowGeometryUITestConditions.GeometryReceipt? {
        // Bind adaptive measurements to the latest logical route key; root screens may own geometry without emitting them.
        let marker = UITestConditions.element(app, "navigation-test-observation")
        guard marker.exists,
              let observation = try? JSONSerialization.jsonObject(with: Data(UITestConditions.text(marker).utf8)) as? [String: Any],
              let reference = observation["windowGeometry"] as? [String: Any],
              let lifecycle = observation["lifecycle"] as? [[String: Any]],
              let state = lifecycle.last(where: {
                  $0["event"] as? String == "state-change" || $0["event"] as? String == "layout-sync"
              }),
              let logicalRouteKeys = state["logicalKeys"] as? [String],
              let currentRouteKey = logicalRouteKeys.last,
              let event = lifecycle.last(where: { $0["event"] as? String == "window-geometry" }),
              let context = lifecycle.last(where: { $0["event"] as? String == "window-geometry-context" }),
              let eventJSON = event["nativePayload"] as? String,
              let eventSnapshotJSON = event["normalizedSnapshot"] as? String,
              let contextSnapshotJSON = context["normalizedSnapshot"] as? String,
              let referenceData = try? JSONSerialization.data(withJSONObject: reference),
              let native = try? JSONDecoder().decode(NavigationWindowGeometryUITestConditions.GeometryPayload.self, from: Data(eventJSON.utf8)),
              let eventSnapshot = try? JSONDecoder().decode(NavigationWindowGeometryUITestConditions.GeometrySnapshot.self, from: Data(eventSnapshotJSON.utf8)),
              let contextSnapshot = try? JSONDecoder().decode(NavigationWindowGeometryUITestConditions.GeometrySnapshot.self, from: Data(contextSnapshotJSON.utf8)),
              let publicUIKit = try? JSONDecoder().decode(NavigationWindowGeometryUITestConditions.GeometryPayload.self, from: referenceData)
        else {
            return nil
        }
        let adaptive: (routeKey: String, width: Double, columns: Int)? = lifecycle.last {
            $0["event"] as? String == "adaptive-columns-layout"
        }.flatMap { event in
            guard event["active"] as? Bool == true, let routeKey = event["routeKey"] as? String,
                  let width = (event["width"] as? String).flatMap(Double.init),
                  let columns = (event["columns"] as? String).flatMap(Int.init) else { return nil }
            return (routeKey: routeKey, width: width, columns: columns)
        }
        guard !requiresAdaptiveLayout || adaptive?.routeKey == currentRouteKey else { return nil }
        return NavigationWindowGeometryUITestConditions.GeometryReceipt(
            routeKey: currentRouteKey, native: native, eventSnapshot: eventSnapshot, contextSnapshot: contextSnapshot,
            publicUIKit: publicUIKit, adaptive: adaptive,
        )
    }
}
