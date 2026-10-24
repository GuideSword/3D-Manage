const test = require('node:test');
const assert = require('node:assert/strict');
const { getResponsiveLayout } = require('../../utils/responsiveLayout.cjs');

test('uses mobile layout below the desktop breakpoint', () => {
  assert.deepEqual(getResponsiveLayout(767, 'web'), { isWeb: true, isDesktop: false, isCompactDesktop: false });
});

test('uses full desktop layout at 1024px and above', () => {
  assert.deepEqual(getResponsiveLayout(1024, 'web'), { isWeb: true, isDesktop: true, isCompactDesktop: false });
});

test('marks the 768-1023 range as compact desktop', () => {
  assert.deepEqual(getResponsiveLayout(900, 'web'), { isWeb: true, isDesktop: true, isCompactDesktop: true });
});

test('never activates desktop chrome on native platforms', () => {
  assert.deepEqual(getResponsiveLayout(1440, 'ios'), { isWeb: false, isDesktop: false, isCompactDesktop: false });
});
