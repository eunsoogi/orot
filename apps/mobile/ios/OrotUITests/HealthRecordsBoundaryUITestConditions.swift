import XCTest

/// Reveals synthetic health controls in their actual scroll owner without XCTest's rotated application envelope.
@MainActor
enum HealthRecordsBoundaryUITestConditions {
    struct Owner {
        let identifier: String
        var horizontal = false
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
            let scroll = container.scrollViews.firstMatch.exists ? container.scrollViews.firstMatch : container
            while true {
                let window = app.windows.firstMatch.frame
                let content = UITestConditions.element(app, "navigation-content-region").frame
                let scrollFrame = scroll.frame
                let viewport = scrollFrame.intersection(window).intersection(content)
                let frame = target.frame
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
