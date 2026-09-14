import { DARK_COLORS, LIGHT_COLORS } from '../../constants';

export const cyberTheme = (dark) => {
  const colors = dark ? DARK_COLORS : LIGHT_COLORS;
  return {
  ...colors,
  glass: colors.surfaceElevated,
  muted: colors.textSecondary,
  pink: colors.accent,
  pinkSoft: colors.accentSoft,
  blue: colors.info,
  blueSoft: colors.infoSoft,
  onAccent: '#FFFFFF',
  hero: ['#292559', '#49427A', '#262343'],
  pinkCard: ['#392541', '#27223D'],
  blueCard: ['#20374B', '#24233F'],
  glow: '#8372EB',
  ...(dark ? {} : {
    hero: ['#969DF6', '#C2B8FF', '#E6E7FF'],
    pinkCard: ['#FFF0FC', '#F8F3FF'],
    blueCard: ['#E6F8FF', '#F1F2FF'],
    glow: '#B6A2FF',
  }),
  };
};
