import XCTest

/// Reveals synthetic health controls in their actual scroll owner without XCTest's rotated application envelope.
@MainActor
enum HealthRecordsBoundaryUITestConditions {
    struct Owner {
        let identifier: String
        var horizontal = false
    }

    /// Reaches the production route using its genuine controls, with no
    /// open-ended generic AX polling before the viewport assertion.
    static func verifyMeasuredLibraryEdge(_ app: XCUIApplication, testCase: XCTestCase) throws {
        let ready = UITestConditions.element(app, "health-pagination-requests")
        try requireBounded(ready, phase: "synthetic app root")
        let save = app.buttons["assistant-appearance-save"]
        if save.exists {
            let star = UITestConditions.element(app, "assistant-appearance-avatar-star")
            try requireBounded(star, phase: "first-run appearance choice")
            star.tap()
            save.tap()
        }
        let records = app.buttons["navigation-tab-records"]
        if records.waitForExistence(timeout: 4) {
            records.tap()
        } else {
            let overflow = app.buttons["navigation-page-action-overflow"]
            try requireBounded(overflow, phase: "Records tab or native overflow")
            overflow.tap()
            let labels = NSPredicate(format: "label IN %@", ["기록 탭", "Records tab", "Records"])
            let menuRecord = app.buttons.matching(labels).firstMatch
            try requireBounded(menuRecord, phase: "Records overflow item")
            menuRecord.tap()
        }
        let recordsHeading = UITestConditions.element(app, "records-title")
        let library = UITestConditions.element(app, "records-open-health-library")
        try requireBounded(recordsHeading, phase: "Records route")
        try requireBounded(library, phase: "Health Records entry")
        library.tap()
        try requireBounded(UITestConditions.element(app, "health-records-title"), phase: "Health Records route")
        let menu = UITestConditions.element(app, "health-record-category-filter")
        try requireBounded(menu, phase: "Health Records native chip strip")
        let shield = UITestConditions.element(app, "health-records-primary-scroll-host")
        try requireBounded(shield, phase: "Health Records native primary viewport")
        let observed = try XCTUnwrap(NavigationUITestConditions.observationSnapshot(app, testCase: testCase, attachmentName: "health-right-edge-owned-window"))
        let native = try XCTUnwrap(observed["windowGeometry"] as? [String: Any])
        let lifecycle = try XCTUnwrap(observed["lifecycle"] as? [[String: Any]])
        let sharedEvent = try XCTUnwrap(lifecycle.last { $0["event"] as? String == "navigation-content-frame" })
        let json = try XCTUnwrap(sharedEvent["frame"] as? String)
        let shared = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        let window = try decodeRect(native["windowBounds"])
        XCTAssertEqual(shared["side"] as? String, "right", "A compact or different host cannot prove the right rail")
        let available = try decodeRect(shared["availableContentFrame"])
        let sharedWindow = try decodeRect(shared["windowFrame"])
        XCTAssertTrue(FormScrollGeometry.stableStageFrame(window, sharedWindow))
        let rail = try decodeRect(shared["navigationFrame"])
        let list = UITestConditions.element(app, "health-records-scroll").frame
        let title = UITestConditions.element(app, "health-records-title").frame
        let frames = ["window": window, "content": available, "rail": rail, "list": list, "menu": menu.frame, "title": title]
        try NavigationUITestConditions.panelSnapshot(app, frames: frames, testCase: testCase)
        XCTAssertTrue(available.insetBy(dx: -0.5, dy: -0.5).contains(title))
        XCTAssertGreaterThan(window.maxX - available.maxX, 30)
        XCTAssertEqual(list.maxX, window.maxX, accuracy: 1)
        XCTAssertEqual(menu.frame.maxX, window.maxX, accuracy: 1)
        XCTAssertGreaterThan(list.maxX, rail.maxX)
        NavigationGeometryUITestConditions.captureScreen(app, name: "health-native-right-edge", testCase: testCase)
    }

    private static func requireBounded(_ element: XCUIElement, phase: String) throws {
        guard element.waitForExistence(timeout: 6) else {
            XCTFail("Health edge scenario did not reach: \(phase)")
            throw NSError(domain: "HealthRecordsEdgeVerification", code: 1)
        }
    }

    private static func decodeRect(_ value: Any?) throws -> CGRect {
        let rect = try XCTUnwrap(value as? [String: Double])
        return try CGRect(x: XCTUnwrap(rect["x"]), y: XCTUnwrap(rect["y"]),
                          width: XCTUnwrap(rect["width"]), height: XCTUnwrap(rect["height"]))
    }

    /// Measure native scroll/chip bounds separately from the still-inset chart content.
    static func captureLibraryEdge(_ app: XCUIApplication, name: String, testCase: XCTestCase) throws {
        try NavigationGeometryUITestConditions.captureBoundary(app, navigationID: "navigation-back", name: name, testCase: testCase)
        let geometry = try NavigationGeometryUITestConditions.snapshot(app)
        let host = UITestConditions.element(app, "health-records-primary-scroll-host").frame
        let content = UITestConditions.element(app, "navigation-content-region").frame
        let list = UITestConditions.element(app, "health-records-scroll").frame
        let menu = UITestConditions.element(app, "health-record-category-filter").frame
        let title = UITestConditions.element(app, "health-records-title").frame
        let frames = ["window": geometry.window, "content": content, "list": list, "menu": menu, "title": title]
        try NavigationUITestConditions.panelSnapshot(app, frames: frames, testCase: testCase)
        XCTAssertTrue([host, content, list, menu, title].allSatisfy(FormScrollGeometry.valid))
        XCTAssertTrue(content.insetBy(dx: -0.5, dy: -0.5).contains(title))
        if geometry.window.maxX - content.maxX > 30, abs(host.maxX - content.maxX) <= 1 {
            XCTAssertEqual(list.maxX, geometry.window.maxX, accuracy: 1)
            XCTAssertEqual(menu.maxX, geometry.window.maxX, accuracy: 1)
            XCTAssertGreaterThan(list.maxX, content.maxX)
            XCTAssertGreaterThan(menu.maxX, content.maxX)
        } else {
            XCTAssertLessThanOrEqual(list.maxX, content.maxX + 0.5)
            XCTAssertLessThanOrEqual(menu.maxX, content.maxX + 0.5)
        }
    }

    /// Parent exposure and horizontal-chip exposure share the original eight-gesture total limit.
    static func tap(_ app: XCUIApplication, identifier: String, owners: [Owner], testCase: XCTestCase) throws {
        var gestures = 0
        for index in owners.indices {
            let owner = owners[index]
            let container = UITestConditions.element(app, owner.identifier)
            let targetID = index + 1 < owners.count ? owners[index + 1].identifier : identifier
            let target = UITestConditions.element(app, targetID)
            XCTAssertTrue(UITestConditions.exists(container) && UITestConditions.exists(target))
            let nestedScroll = container.scrollViews.firstMatch
            let scroll = container.elementType == .scrollView || !nestedScroll.exists ? container : nestedScroll
            while true {
                let window = app.windows.firstMatch.frame
                let content = UITestConditions.element(app, "navigation-content-region").frame
                let scrollFrame = scroll.frame
                let viewport = scrollFrame.intersection(window).intersection(content)
                // A nested menu may bleed under the rail. The parent only
                // needs to expose its safe, interactive portion vertically.
                let rawFrame = target.frame
                let frame = index + 1 < owners.count && owners[index + 1].horizontal
                    ? CGRect(x: max(rawFrame.minX, content.minX), y: rawFrame.minY,
                             width: min(rawFrame.maxX, content.maxX) - max(rawFrame.minX, content.minX), height: rawFrame.height)
                    : rawFrame
                try NavigationUITestConditions.panelSnapshot(app, frames: ["window": window, "owner": scrollFrame, "viewport": viewport, "target": frame], testCase: testCase)
                guard !viewport.isNull, !viewport.isEmpty, !frame.isEmpty else {
                    XCTFail("The actual scroll owner and target need finite visible frames: \(owner.identifier)")
                    return
                }
                if viewport.insetBy(dx: -0.5, dy: -0.5).contains(frame) {
                    if index == owners.count - 1 {
                        XCTAssertTrue(target.isHittable, target.debugDescription)
                        target.tap()
                    }
                    break
                }
                // A target larger than its real viewport cannot be repaired by additional swipes.
                guard frame.width <= viewport.width + 0.5, frame.height <= viewport.height + 0.5, gestures < 8 else {
                    XCTFail("The target cannot be fully exposed within the original gesture limit: \(targetID)")
                    return
                }
                var x = viewport.midX
                if !owner.horizontal, index + 1 < owners.count, frame.intersects(viewport) {
                    // Keep the parent's vertical drag outside its nested horizontal recognizer.
                    let left = frame.minX - viewport.minX, right = viewport.maxX - frame.maxX
                    guard max(left, right) > 0.5 else {
                        XCTFail("No observed parent-only gesture band beside the nested scroll")
                        return
                    }
                    x = left >= right ? viewport.minX + left / 2 : frame.maxX + right / 2
                }
                let towardStart = owner.horizontal ? frame.minX < viewport.minX : frame.minY < viewport.minY
                let overflow = owner.horizontal ? (towardStart ? viewport.minX - frame.minX : frame.maxX - viewport.maxX) :
                    (towardStart ? viewport.minY - frame.minY : frame.maxY - viewport.maxY)
                // Match the existing form policy: approach a tall, partially exposed target by its measured clipped distance.
                let distance = min(max(overflow + 8, 30), (owner.horizontal ? viewport.width : viewport.height) * 0.45)
                let start = CGPoint(x: owner.horizontal ? viewport.minX + viewport.width * (towardStart ? 0.25 : 0.75) : x,
                                    y: owner.horizontal ? viewport.midY : viewport.minY + viewport.height * (towardStart ? 0.25 : 0.75))
                let end = CGPoint(x: start.x + (owner.horizontal ? (towardStart ? distance : -distance) : 0),
                                  y: start.y + (owner.horizontal ? 0 : (towardStart ? distance : -distance)))
                // The measured owner also anchors input, preserving its native display instead of the application's default display.
                let origin = scroll.coordinate(withNormalizedOffset: .zero)
                let ownerOrigin = scrollFrame.origin
                let from = origin.withOffset(CGVector(dx: start.x - ownerOrigin.x, dy: start.y - ownerOrigin.y))
                let to = origin.withOffset(CGVector(dx: end.x - ownerOrigin.x, dy: end.y - ownerOrigin.y))
                // Default-speed inertia can cross the opposite edge; later frame checks still decide whether exposure succeeded.
                let velocity: XCUIGestureVelocity = viewport.intersects(frame) ? .slow : .default
                from.press(forDuration: 0.05, thenDragTo: to, withVelocity: velocity, thenHoldForDuration: 0)
                gestures += 1
            }
        }
    }
}
