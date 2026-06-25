import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '../constants';

const Button = ({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  iconLeft,
  iconRight,
  fullWidth = false,
  style,
  textStyle,
  ...props
}) => {
  const isInactive = disabled || loading;
  const contentColor = getContentColor(variant, isInactive);

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      style={[
        styles.button,
        styles[size] || styles.medium,
        styles[variant] || styles.primary,
        fullWidth && styles.fullWidth,
        isInactive && styles.disabled,
        style,
      ]}
      onPress={isInactive ? undefined : onPress}
      disabled={isInactive}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={contentColor} />
      ) : (
        <View style={styles.content}>
          {iconLeft ? (
            <Ionicons name={iconLeft} size={getIconSize(size)} color={contentColor} />
          ) : null}
          {title ? (
            <Text
              style={[
                styles.text,
                styles[`${size}Text`] || styles.mediumText,
                { color: contentColor },
                textStyle,
              ]}
              numberOfLines={1}
            >
              {title}
            </Text>
          ) : null}
          {iconRight ? (
            <Ionicons name={iconRight} size={getIconSize(size)} color={contentColor} />
          ) : null}
        </View>
      )}
    </TouchableOpacity>
  );
};

const getContentColor = (variant, disabled) => {
  if (disabled) return COLORS.textTertiary;
  if (['outline', 'ghost', 'secondary'].includes(variant)) return COLORS.primary;
  if (variant === 'warning') return COLORS.background;
  return COLORS.surfaceElevated;
};

const getIconSize = (size) => {
  if (size === 'small') return 16;
  if (size === 'large') return 20;
  return 18;
};

const styles = StyleSheet.create({
  button: {
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  small: {
    minHeight: 34,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  medium: {
    minHeight: 44,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 10,
  },
  large: {
    minHeight: 50,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
  },
  primary: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  secondary: {
    backgroundColor: COLORS.primarySoft,
    borderColor: COLORS.primarySoft,
  },
  success: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  warning: {
    backgroundColor: COLORS.warning,
    borderColor: COLORS.warning,
  },
  danger: {
    backgroundColor: COLORS.danger,
    borderColor: COLORS.danger,
  },
  outline: {
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.borderStrong,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  disabled: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    opacity: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    maxWidth: '100%',
  },
  text: {
    fontWeight: '700',
    textAlign: 'center',
  },
  smallText: {
    ...TYPOGRAPHY.caption,
  },
  mediumText: {
    fontSize: 15,
    lineHeight: 20,
  },
  largeText: {
    fontSize: 16,
    lineHeight: 22,
  },
});

export default Button;
