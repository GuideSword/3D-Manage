import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SPACING } from '../constants';
import { useAppTheme } from '../context/ThemeContext';

const paddingStyles = {
  none: { padding: 0 },
  small: { padding: SPACING.md },
  medium: { padding: SPACING.lg },
  large: { padding: SPACING.xl },
};

const Card = ({
  children,
  style,
  variant = 'default',
  padding = 'medium',
  interactive = false,
  ...props
}) => {
  const { colors, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(colors, shadows), [colors, shadows]);

  return (
    <View
      style={[
        styles.card,
        styles[variant] || styles.default,
        paddingStyles[padding] || paddingStyles.medium,
        interactive && styles.interactive,
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
};

const createStyles = (colors, shadows) => StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    marginVertical: SPACING.xs,
    marginHorizontal: SPACING.sm,
  },
  default: {
    backgroundColor: colors.surfaceElevated,
    ...Platform.select({
      web: {
        boxShadow: shadows.cardWeb,
      },
      default: shadows.card,
    }),
  },
  muted: {
    backgroundColor: colors.surfaceMuted,
  },
  section: {
    backgroundColor: colors.surfaceElevated,
  },
  interactive: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.borderStrong,
  },
});

export default Card;
