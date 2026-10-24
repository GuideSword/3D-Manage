const DESKTOP_BREAKPOINT = 768;
const COMPACT_DESKTOP_BREAKPOINT = 1024;

function getResponsiveLayout(width, platform = 'web') {
  const isWeb = platform === 'web';
  const safeWidth = Number.isFinite(width) ? width : 0;
  const isDesktop = isWeb && safeWidth >= DESKTOP_BREAKPOINT;

  return {
    isWeb,
    isDesktop,
    isCompactDesktop: isDesktop && safeWidth < COMPACT_DESKTOP_BREAKPOINT,
  };
}

module.exports = {
  DESKTOP_BREAKPOINT,
  COMPACT_DESKTOP_BREAKPOINT,
  getResponsiveLayout,
};
