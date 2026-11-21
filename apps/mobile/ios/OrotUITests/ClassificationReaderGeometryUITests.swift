import XCTest

/// A no-store product reader isolates UIKit wide/XXXL pagination and real Modal dismissal.
extension AppointmentConsentUITests {
    @MainActor
    func testWideLargeTextReaderPreservesContentAndNativeDismissal() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        XCUIDevice.shared.orientation = .portrait
        let session = UUID().uuidString
        app.launchArguments = ["-OROT_TEST_ROTATION_GEOMETRY_SESSION", session, "-OROT_E2E_PROBE", "medical-appointment-classification",
                               "-OROT_TEST_CLASSIFICATION_READER_GEOMETRY", "YES",
                               "-OROT_TEST_CLASSIFICATION_LAYOUT", "YES",
                               "-OROT_TEST_NAVIGATION_FOCUS_OBSERVATION", "YES",
                               "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        try geometryWait { self.node(app, "classification-geometry-stage").exists }
        try settleReaderScene(app, session: session)
        try captureReaderGeometry(app)
        XCTAssertEqual(node(app, "classification-geometry-actions").label, "actions=0;lane=natural")
        XCTAssertFalse(node(app, "classification-close-reader").exists)
        let pages = try readerPages(app)
        // Expected contents are generated independently, not read from a fixture receipt.
        let expected = (1 ... 2).flatMap { document in
            ["title", "reason"].flatMap { field in (1 ... 24).map { "DOC\(document)_\(field)_\($0)" } }
        }.joined()
        XCTAssertEqual(pages.joined().filter { !$0.isWhitespace }, expected)
        for text in pages.dropLast().reversed() {
            node(app, "medical-appointment-previous-result").tap()
            try geometryWait { UITestConditions.text(self.node(app, "classification-page-text")) == text }
        }
        XCTAssertFalse(node(app, "medical-appointment-previous-result").isEnabled)
        let natural = node(app, "classification-geometry-lane").frame
        node(app, "classification-geometry-constrain").tap()
        try geometryWait { self.node(app, "classification-geometry-lane").frame.height == 64 }
        let primary = node(app, "medical-appointment-import")
        try geometryWait { primary.label == "전체 화면으로 내용 보기" && primary.isHittable }
        XCTAssertLessThan(node(app, "classification-geometry-lane").frame.height, natural.height)
        XCTAssertFalse(node(app, "classification-page-text").exists)
        primary.tap()
        let close = node(app, "classification-close-reader")
        try geometryWait { close.exists && close.isHittable }
        XCTAssertGreaterThanOrEqual(close.frame.width, 44)
        XCTAssertGreaterThanOrEqual(close.frame.height, 44)
        let expandedPages = try readerPages(app)
        XCTAssertEqual(expandedPages.joined().filter { !$0.isWhitespace }, expected)
        close.tap()
        try geometryWait { !close.exists && primary.label == "전체 화면으로 내용 보기" && primary.isHittable }
        XCTAssertEqual(node(app, "classification-geometry-actions").label, "actions=0;lane=constrained")
        XCTAssertEqual(node(app, "classification-geometry-lane").frame.height, 64)
        primary.tap()
        try geometryWait { close.exists && primary.label == "Local action" && primary.isHittable }
        // Only the real UIKit dismissal can deliver the product's pending action.
        primary.tap()
        try geometryWait { !close.exists && self.node(app, "classification-geometry-actions").label == "actions=1;lane=constrained" }
        XCTAssertTrue(node(app, "classification-geometry-stage").exists)
        XCTAssertEqual(node(app, "classification-geometry-actions").label, "actions=1;lane=constrained")
    }

    /// Arm the mounted owner before one supported request; a missing/denied scene event remains a failure.
    @discardableResult
    @MainActor
    func settleReaderScene(_ app: XCUIApplication, session: String, hostID: String = "classification-geometry-host") throws -> CGRect {
        let control = node(app, "classification-reader-scene")
        let host = node(app, hostID)
        XCTAssertEqual(app.windows.count, 1)
        let owner = app.windows.firstMatch
        XCTAssertTrue(owner.frame.contains(host.frame) && owner.frame.contains(control.frame))
        XCTAssertGreaterThan(owner.frame.height, owner.frame.width)
        func command(_ mode: String) throws -> [String: Any] {
            let previous = control.label
            XCTAssertTrue(control.isEnabled && control.isHittable)
            control.tap()
            try geometryWait { control.label != previous }
            let data = Data(control.label.utf8)
            let packet = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            // Save the first actual response, including denied/unsettled state, before an assertion exits.
            let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
            attachment.name = "reader-scene-\(mode)"
            attachment.lifetime = .keepAlways
            add(attachment)
            let receipt = try XCTUnwrap(packet["receipt"] as? [String: Any])
            XCTAssertEqual(receipt["mode"] as? String, mode)
            XCTAssertEqual(receipt["session"] as? String, session)
            return packet
        }
        let armedPacket = try command("start")
        XCTAssertEqual(armedPacket["outcome"] as? String, "armed")
        let armed = try XCTUnwrap(armedPacket["receipt"] as? [String: Any])
        let requested = try command("request")
        XCTAssertEqual(requested["outcome"] as? String, "requested")
        let wide = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            owner.exists && owner.frame.width > owner.frame.height && host.exists && control.exists
        }, object: nil)
        let reflow = XCTWaiter.wait(for: [wide], timeout: 20)
        // Read once even on failed reflow to preserve UIKit's actual asynchronous denial/event receipt.
        let final = try command("read")
        XCTAssertEqual(final["outcome"] as? String, "settled")
        XCTAssertEqual(reflow, .completed)
        let receipt = try XCTUnwrap(final["receipt"] as? [String: Any])
        for key in ["sceneID", "windowID"] {
            XCTAssertEqual(receipt[key] as? String, armed[key] as? String)
        }
        XCTAssertEqual(receipt["generation"] as? Int, armed["generation"] as? Int)
        XCTAssertEqual(receipt["candidateWindowCount"] as? Int, 1)
        XCTAssertLessThanOrEqual(try XCTUnwrap(receipt["requestCount"] as? Int), 1)
        XCTAssertTrue((receipt["error"] as? [String: Any])?.isEmpty == true)
        let bounds = try XCTUnwrap(receipt["windowBounds"] as? [String: Double])
        XCTAssertEqual(try XCTUnwrap(bounds["width"]), Double(owner.frame.width), accuracy: 0.5)
        XCTAssertEqual(try XCTUnwrap(bounds["height"]), Double(owner.frame.height), accuracy: 0.5)
        XCTAssertGreaterThan(owner.frame.width, owner.frame.height)
        XCTAssertTrue(owner.frame.contains(host.frame) && owner.frame.contains(control.frame))
        return owner.frame
    }

    @MainActor
    private func geometryWait(_ predicate: @escaping () -> Bool) throws {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in predicate() }, object: nil)
        let result = XCTWaiter.wait(for: [expectation], timeout: 20)
        guard result == .completed else {
            XCTFail("Bounded synthetic reader prerequisite")
            throw NSError(domain: "ClassificationReaderGeometry", code: 1)
        }
    }

    @MainActor
    private func readerPages(_ app: XCUIApplication) throws -> [String] {
        try geometryWait { self.node(app, "classification-page-text").exists }
        XCTAssertFalse(node(app, "medical-appointment-previous-result").isEnabled)
        var pages: [String] = []
        for _ in 0 ..< 256 {
            for identifier in ["classification-geometry-stage", "classification-page-text", "classification-text-viewport", "classification-stage-footer"] {
                XCTAssertEqual(app.descendants(matching: .any).matching(identifier: identifier).count, 1)
            }
            let page = node(app, "classification-page-text")
            let text = UITestConditions.text(page)
            XCTAssertFalse(text.isEmpty)
            XCTAssertFalse(pages.contains(text), "No duplicated page")
            let viewport = node(app, "classification-text-viewport")
            XCTAssertTrue(app.windows.firstMatch.frame.contains(viewport.frame))
            XCTAssertTrue(app.windows.firstMatch.frame.contains(page.frame))
            XCTAssertTrue(viewport.frame.insetBy(dx: -1, dy: -1).contains(page.frame))
            let footer = node(app, "classification-stage-footer")
            XCTAssertTrue(app.frame.contains(footer.frame))
            let circle = node(app, "medical-appointment-import")
            XCTAssertTrue(node(app, "classification-circle-slot").frame.insetBy(dx: -1, dy: -1).contains(circle.frame))
            XCTAssertGreaterThanOrEqual(circle.frame.height, 44)
            XCTAssertEqual(circle.frame.width, circle.frame.height, accuracy: 1)
            if circle.isEnabled { XCTAssertTrue(circle.isHittable) }
            for identifier in ["medical-appointment-previous-result", "medical-appointment-next-result"] {
                let element = node(app, identifier)
                XCTAssertGreaterThanOrEqual(element.frame.width, 44)
                XCTAssertGreaterThanOrEqual(element.frame.height, 44)
                XCTAssertTrue(footer.frame.insetBy(dx: -1, dy: -1).contains(element.frame))
                if element.isEnabled {
                    XCTAssertTrue(element.isHittable)
                }
            }
            pages.append(text)
            let next = node(app, "medical-appointment-next-result")
            if !next.isEnabled {
                return pages
            }
            next.tap()
            try geometryWait { UITestConditions.text(page) != text }
        }
        XCTFail("All synthetic text must terminate within 256 pages")
        return pages
    }

    @MainActor
    private func captureReaderGeometry(_ app: XCUIApplication) throws {
        let marker = node(app, "classification-layout-receipt")
        let old = UITestConditions.text(marker)
        let requested = Date().timeIntervalSince1970 * 1000
        node(app, "classification-geometry-sample").tap()
        try geometryWait { UITestConditions.text(marker) != old }
        let data = Data(UITestConditions.text(marker).utf8)
        let report = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let requestedAt = try XCTUnwrap(report["requestedAtMs"] as? Double)
        let started = try XCTUnwrap(report["sampleStartedAtMs"] as? Double)
        let ended = try XCTUnwrap(report["sampleEndedAtMs"] as? Double)
        XCTAssertGreaterThanOrEqual(requestedAt, requested)
        XCTAssertGreaterThanOrEqual(started, requestedAt)
        XCTAssertGreaterThanOrEqual(ended, started)
        XCTAssertLessThanOrEqual(ended, Date().timeIntervalSince1970 * 1000)
        XCTAssertEqual(report["contentSizeCategory"] as? String, "UICTContentSizeCategoryAccessibilityXXXL")
        XCTAssertEqual(report["visibleKeyWindowCount"] as? Int, 1)
        let frame = try XCTUnwrap(report["windowFrameInScreen"] as? [String: Double])
        let window = app.windows.firstMatch.frame
        XCTAssertGreaterThan(window.width, window.height, "A launch argument is not evidence of a wide window")
        for (key, value) in [("x", window.minX), ("y", window.minY), ("width", window.width), ("height", window.height)] {
            XCTAssertEqual(try XCTUnwrap(frame[key]), Double(value), accuracy: 1)
        }
        var receipt = report
        receipt["naturalLane"] = ViewportObservation.rect(node(app, "classification-geometry-lane").frame)
        receipt["fixtureControls"] = "45pt reserved; constrained phase is explicit test-only 64pt lane"
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: receipt), uniformTypeIdentifier: "public.json")
        attachment.name = "reader-natural-wide-XXXL"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
