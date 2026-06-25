import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { COLORS, RADIUS, SHADOWS, SPACING } from '../constants';

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

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginVertical: SPACING.xs,
    marginHorizontal: SPACING.sm,
  },
  default: {
    backgroundColor: COLORS.surfaceElevated,
    ...Platform.select({
      web: {
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
      },
      default: SHADOWS.card,
    }),
  },
  muted: {
    backgroundColor: COLORS.surfaceMuted,
  },
  section: {
    backgroundColor: COLORS.surfaceElevated,
  },
  interactive: {
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.borderStrong,
  },
});

export default Card;
