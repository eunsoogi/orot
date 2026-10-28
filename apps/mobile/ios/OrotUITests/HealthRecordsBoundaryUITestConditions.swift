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
                let viewport = scroll.frame.intersection(window).intersection(content)
                let frame = target.frame
                try NavigationUITestConditions.panelSnapshot(app, frames: ["window": window, "owner": scroll.frame, "viewport": viewport, "target": frame], testCase: testCase)
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
                let start = CGPoint(x: owner.horizontal ? viewport.minX + viewport.width * (towardStart ? 0.25 : 0.75) : x,
                                    y: owner.horizontal ? viewport.midY : viewport.minY + viewport.height * (towardStart ? 0.25 : 0.75))
                let end = CGPoint(x: start.x + (owner.horizontal ? viewport.width * (towardStart ? 0.45 : -0.45) : 0),
                                  y: start.y + (owner.horizontal ? 0 : viewport.height * (towardStart ? 0.45 : -0.45)))
                let origin = app.coordinate(withNormalizedOffset: .zero)
                let applicationOrigin = app.frame.origin
                let from = origin.withOffset(CGVector(dx: start.x - applicationOrigin.x, dy: start.y - applicationOrigin.y))
                let to = origin.withOffset(CGVector(dx: end.x - applicationOrigin.x, dy: end.y - applicationOrigin.y))
                from.press(forDuration: 0.05, thenDragTo: to)
                gestures += 1
            }
        }
    }
}
