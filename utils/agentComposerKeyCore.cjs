'use strict';

function shouldSendOnEnter({ platform, key, shiftKey, isComposing = false }) {
  return platform === 'web'
    && key === 'Enter'
    && shiftKey !== true
    && isComposing !== true;
}

module.exports = { shouldSendOnEnter };
