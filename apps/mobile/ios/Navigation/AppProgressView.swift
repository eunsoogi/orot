import React
import UIKit

/// Own the indicator's animation lifetime even when React retains a detached native view for reuse.
final class AppProgressView: UIActivityIndicatorView {
    @objc var active: Bool = true {
        didSet { updateAnimation() }
    }

    @objc var large: Bool = false {
        didSet { style = large ? .large : .medium }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        style = .medium
        hidesWhenStopped = true
    }

    required init(coder: NSCoder) {
        super.init(coder: coder)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        updateAnimation()
    }

    private func updateAnimation() {
        // A pending operation may outlive its route. Keep its requested state,
        // but stop native animation while detached and resume only on remount.
        if active, window != nil {
            startAnimating()
        } else {
            stopAnimating()
        }
    }
}

@objc(AppProgressViewManager)
final class AppProgressViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func view() -> UIView! {
        AppProgressView(frame: .zero)
    }
}
