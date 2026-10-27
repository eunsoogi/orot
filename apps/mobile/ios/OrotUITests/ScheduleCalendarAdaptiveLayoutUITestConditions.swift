import XCTest

/// Compares Schedule's reported plan with native panel, viewport and rail frames.
@MainActor
enum ScheduleCalendarAdaptiveLayoutUITestConditions {
    struct LayoutEvidence {
        let width: Double
        let columns: Int
    }

    static func waitForLayout(
        _ app: XCUIApplication,
        afterWidth previousWidth: Double?,
    ) throws -> LayoutEvidence {
        var observed: LayoutEvidence?
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                guard let layout = readLayout(app),
                      layout.width > 0,
                      previousWidth.map({ abs(layout.width - $0) > 0.5 }) ?? true
                else { return false }
                observed = layout
                return true
            },
            object: nil,
        )
        XCTAssertEqual(
            UITestConditions.wait(for: [ready]),
            .completed,
            "The active Schedule columns must report their measured width",
        )
        return try XCTUnwrap(observed)
    }

    static func assertPanelFramesFit(
        _ app: XCUIApplication,
        layout: LayoutEvidence,
        file: StaticString,
        line: UInt,
    ) {
        let viewport = UITestConditions.element(app, "navigation-content-region")
        let host = UITestConditions.element(app, "schedule-adaptive-columns-host")
        let primary = UITestConditions.element(app, "schedule-adaptive-columns-primary")
        let secondary = UITestConditions.element(app, "schedule-adaptive-columns-secondary")
        XCTAssertTrue(viewport.exists && !viewport.frame.isEmpty, app.debugDescription, file: file, line: line)
        XCTAssertTrue(host.exists && !host.frame.isEmpty, app.debugDescription, file: file, line: line)
        XCTAssertTrue(primary.exists && !primary.frame.isEmpty, app.debugDescription, file: file, line: line)
        XCTAssertTrue(secondary.exists && !secondary.frame.isEmpty, app.debugDescription, file: file, line: line)
        XCTAssertLessThanOrEqual(host.frame.width, viewport.frame.width + 0.5, file: file, line: line)
        XCTAssertGreaterThanOrEqual(primary.frame.minX, viewport.frame.minX - 0.5, file: file, line: line)
        XCTAssertLessThanOrEqual(primary.frame.maxX, viewport.frame.maxX + 0.5, file: file, line: line)
        XCTAssertGreaterThanOrEqual(secondary.frame.minX, viewport.frame.minX - 0.5, file: file, line: line)
        XCTAssertLessThanOrEqual(secondary.frame.maxX, viewport.frame.maxX + 0.5, file: file, line: line)

        let rail = UITestConditions.element(app, "navigation-right-rail")
        if rail.exists {
            XCTAssertLessThanOrEqual(viewport.frame.maxX, rail.frame.minX + 0.5, file: file, line: line)
            XCTAssertFalse(primary.frame.intersects(rail.frame), file: file, line: line)
            XCTAssertFalse(secondary.frame.intersects(rail.frame), file: file, line: line)
        }
        XCTAssertTrue((1 ... 2).contains(layout.columns), "Unsupported Schedule column count", file: file, line: line)
        if layout.columns == 2 {
            XCTAssertEqual(primary.frame.minY, secondary.frame.minY, accuracy: 1, file: file, line: line)
            XCTAssertLessThanOrEqual(primary.frame.maxX, secondary.frame.minX + 0.5, file: file, line: line)
        } else {
            XCTAssertFalse(primary.frame.intersects(secondary.frame), file: file, line: line)
        }
    }

    static func changeOrientation(
        _ app: XCUIApplication,
        to orientation: UIDeviceOrientation,
        after previousFrame: CGRect,
    ) throws -> CGRect {
        XCUIDevice.shared.orientation = orientation
        var observedFrame: CGRect?
        let landscape = orientation == .landscapeLeft || orientation == .landscapeRight
        let changed = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                let frame = app.frame
                guard !frame.isEmpty,
                      (frame.width > frame.height) == landscape,
                      abs(frame.width - previousFrame.width) > 0.5 ||
                      abs(frame.height - previousFrame.height) > 0.5
                else { return false }
                observedFrame = frame
                return true
            },
            object: nil,
        )
        XCTAssertEqual(
            UITestConditions.wait(for: [changed]),
            .completed,
            "The active window must report the requested orientation",
        )
        return try XCTUnwrap(observedFrame)
    }

    private static func readLayout(_ app: XCUIApplication) -> LayoutEvidence? {
        let marker = UITestConditions.element(app, "navigation-test-observation")
        guard marker.exists,
              let data = UITestConditions.text(marker).data(using: .utf8),
              let report = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let lifecycle = report["lifecycle"] as? [[String: Any]],
              let event = lifecycle.last(where: {
                  $0["event"] as? String == "adaptive-columns-layout" &&
                      $0["routeKey"] as? String == "schedule" &&
                      $0["active"] as? Bool == true
              }),
              let widthText = event["width"] as? String,
              let width = Double(widthText),
              let columnText = event["columns"] as? String,
              let columns = Int(columnText)
        else { return nil }
        return LayoutEvidence(width: width, columns: columns)
    }
}
