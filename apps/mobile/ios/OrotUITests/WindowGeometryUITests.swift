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

    /// Exercises the complete source-return and rail assertions without claiming a rotation result.
    @MainActor
    func testDuoPortraitGeometryRetainsQuestionDraftAcrossSourceNavigation() throws {
        XCUIDevice.shared.orientation = .portrait
        try runGeometryBridgeAndRetainQuestionDraftAcrossSourceNavigation()
    }

    /// Separate profile identifiers keep iPhone and Duo results distinct while sharing one route journey.
    @MainActor
    private func runGeometryBridgeAndRetainQuestionDraftAcrossSourceNavigation(verifyAdaptiveReflow: Bool = false) throws {
        let app = XCUIApplication()
        let inputObservation = ProcessInfo.processInfo.environment["OROT_TEST_VISIT_QUESTION_INPUT_OBSERVATION"] == "1"
            ? EncounterInputObservation()
            : nil
        if let inputObservation {
            try observeRetainedVisitInput(app, inputObservation: inputObservation)
        }
        let launchArguments = [
            "-OROT_TEST_SCENARIO", "ai-feature-visit-questions",
            "-OROT_EVIDENCE_SOURCE_DUO_VISUAL_STATE", "synthetic",
            "-OROT_TEST_UI_GEOMETRY", "YES",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launchArguments = launchArguments
        app.launch()
        defer { app.terminate() }

        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "welcome-title")))
        try NavigationUITestConditions.openTab(app, "ai", markers: ["rag-conversation-screen"])
        // The selected tab and visible screen marker identify this screen-owned root without a scene adaptive event.
        let rootTab = try NavigationUITestConditions.navigationAction(app, "navigation-tab-ai")
        XCTAssertTrue(rootTab.control.isSelected)
        let root = try waitForGeometry(app, requiresAdaptiveLayout: false)
        NavigationWindowGeometryUITestConditions.assertGeometry(root)
        let rootRouteKey = root.routeKey
        let rootFrame = try NavigationGeometryUITestConditions.captureBoundary(
            app, navigationID: "navigation-tab-ai", name: "ai-root-content-and-rail", testCase: self,
        )
        let question = UITestConditions.element(app, "rag-conversation-input")
        XCTAssertTrue(UITestConditions.exists(question) && question.isHittable)
        question.tap()
        question.typeText("source")
        NavigationWindowGeometryUITestConditions.tap(app, "rag-conversation-send")
        let source = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "원문 근거 열기")).firstMatch
        XCTAssertTrue(UITestConditions.exists(source))
        let draft = "draft retained"
        question.tap()
        question.typeText(draft)
        XCTAssertEqual(question.value as? String, draft)
        XCTAssertTrue(source.exists && source.isHittable)
        source.tap()
        // The opt-in saved fixture exercises the integrated source route without user records.
        let sourceDetail = UITestConditions.element(app, "ai-feature-source-detail")
        XCTAssertTrue(UITestConditions.exists(sourceDetail))
        let sourceGeometry = try waitForGeometry(app)
        let sourceLayout = try XCTUnwrap(sourceGeometry.adaptive)
        XCTAssertNotEqual(sourceGeometry.routeKey, rootRouteKey, "Opening the source must change the active route")
        XCTAssertEqual(sourceLayout.routeKey, sourceGeometry.routeKey, "Adaptive geometry must belong to the active source route")
        XCTAssertEqual(sourceLayout.columns, 1, "The source screen keeps its current single-column layout")
        NavigationWindowGeometryUITestConditions.assertGeometry(sourceGeometry)
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
        let contextualFrame = try NavigationGeometryUITestConditions.captureBoundary(
            app, navigationID: "navigation-back", name: "source-content-and-rail", testCase: self,
        )
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
        // Preserve the synthetic route observation before waiting, so a stale or missing event is distinguishable.
        _ = NavigationUITestConditions.observationSnapshot(app, testCase: self, attachmentName: "question-after-source-return")
        let restoredQuestion = try waitForGeometry(app, routeKey: rootRouteKey)
        NavigationWindowGeometryUITestConditions.assertGeometry(restoredQuestion)

        if verifyAdaptiveReflow {
            // The Duo run follows UIKit orientation events without synthesizing geometry.
            defer { XCUIDevice.shared.orientation = .portrait }
            let before = try waitForGeometry(app, routeKey: rootRouteKey)
            let beforeLayout = try XCTUnwrap(before.adaptive)
            XCUIDevice.shared.orientation = .landscapeLeft
            let landscape = try waitForGeometry(
                app, widthDifferentFrom: before.publicUIKit.windowBounds.width,
                routeWidthDifferentFrom: beforeLayout.width, routeKey: rootRouteKey,
            )
            let landscapeLayout = try XCTUnwrap(landscape.adaptive)
            XCTAssertTrue(landscapeLayout.routeKey == rootRouteKey && landscapeLayout.columns == 1 && (question.value as? String) == draft)
            XCUIDevice.shared.orientation = .portrait
            let portrait = try waitForGeometry(
                app, widthDifferentFrom: landscape.publicUIKit.windowBounds.width,
                routeWidthDifferentFrom: landscapeLayout.width, routeKey: rootRouteKey,
            )
            let portraitLayout = try XCTUnwrap(portrait.adaptive)
            XCTAssertTrue(portraitLayout.routeKey == rootRouteKey && portraitLayout.columns == 1 && (question.value as? String) == draft)
        }

        let finalQuestion = try waitForGeometry(app, routeKey: rootRouteKey)
        NavigationWindowGeometryUITestConditions.assertGeometry(finalQuestion)
        let conversationFrame = try NavigationGeometryUITestConditions.captureBoundary(
            app, navigationID: "navigation-tab-ai", name: "question-content-and-rail", testCase: self,
        )
        NavigationGeometryUITestConditions.assertSameRailCenter(rootFrame, contextualFrames: [contextualFrame, conversationFrame])
        try NavigationWindowGeometryUITestConditions.verifyObservedSplit(app, testCase: self)
        XCTAssertTrue((question.value as? String) == draft, "The edited question must survive the source-detail route")
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
        let returnedRootTab = try NavigationUITestConditions.navigationAction(app, "navigation-tab-ai")
        XCTAssertTrue(returnedRootTab.control.isSelected)
        let returnedRoot = try waitForGeometry(app, routeKey: rootRouteKey, requiresAdaptiveLayout: false)
        NavigationWindowGeometryUITestConditions.assertGeometry(returnedRoot)
        let returnedRootFrame = try NavigationGeometryUITestConditions.captureBoundary(
            app, navigationID: "navigation-tab-ai", name: "returned-ai-root-content-and-rail", testCase: self,
        )
        NavigationGeometryUITestConditions.assertSameRailCenter(rootFrame, contextualFrames: [contextualFrame, conversationFrame, returnedRootFrame])
    }

    /// The optional diagnostic retains the real question editor and its original UIKit observer in a separate process.
    @MainActor
    private func observeRetainedVisitInput(_ app: XCUIApplication, inputObservation: EncounterInputObservation?) throws {
        var launchArguments = ["-OROT_TEST_SCENARIO", "ai-feature-visit-questions", "-OROT_EVIDENCE_SOURCE_DUO_VISUAL_STATE", "synthetic", "-OROT_TEST_RETAINED_VISIT_OBSERVATION", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        if let inputObservation {
            launchArguments += ["-OROT_TEST_VISIT_QUESTION_INPUT_OBSERVATION", inputObservation.run.uuidString]
        }
        app.launchArguments = launchArguments
        app.launch()
        defer { app.terminate() }
        NavigationWindowGeometryUITestConditions.tap(app, "next-visit-probe-close-tools")
        let generate = UITestConditions.element(app, "next-visit-generate")
        _ = try XCTUnwrap(FormUITestConditions.reveal(generate, in: app, scrollID: "next-visit-questions-scroll"))
        generate.tap()
        NavigationWindowGeometryUITestConditions.tap(app, "next-visit-probe-tools")
        NavigationWindowGeometryUITestConditions.tap(app, "next-visit-probe-complete-generation")
        let question = FormUITestConditions.multilineInput(app, identifier: "next-visit-question-text-0")
        XCTAssertTrue(FormUITestConditions.replace(question, with: "합성 초안 유지", in: app, scrollID: "next-visit-questions-scroll", observeInput: inputObservation.map { observation in
            { phase in observation.captureUIKit(phase, app: app, testCase: self) }
        }, useNativeSelectAllMenu: true))
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
        // A retained route may not publish again on Back; use its own latest measurement, including inactive records.
        let adaptive: (routeKey: String, width: Double, columns: Int)? = lifecycle.last {
            $0["event"] as? String == "adaptive-columns-layout" && $0["routeKey"] as? String == currentRouteKey
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
