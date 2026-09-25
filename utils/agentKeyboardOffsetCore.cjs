'use strict';

function getKeyboardVerticalOffset(windowHeight, layout) {
  if (!Number.isFinite(windowHeight) || !layout ||
      !Number.isFinite(layout.y) || !Number.isFinite(layout.height) || layout.height <= 0) {
    return 0;
  }

  return Math.max(0, windowHeight - (layout.y + layout.height));
}

module.exports = { getKeyboardVerticalOffset };
