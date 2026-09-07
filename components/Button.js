import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SPACING, TYPOGRAPHY } from '../constants';
import { useAppTheme } from '../context/ThemeContext';

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
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isInactive = disabled || loading;
  const contentColor = getContentColor(variant, isInactive, colors);

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

const getContentColor = (variant, disabled, colors) => {
  if (disabled) return colors.textTertiary;
  if (['outline', 'ghost', 'secondary'].includes(variant)) return colors.primary;
  if (variant === 'success') return colors.onSuccess;
  if (variant === 'warning') return colors.onWarning;
  if (variant === 'danger') return colors.onDanger;
  return colors.onPrimary;
};

const getIconSize = (size) => {
  if (size === 'small') return 16;
  if (size === 'large') return 20;
  return 18;
};

const createStyles = (colors) => StyleSheet.create({
  button: {
    borderRadius: 15,
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
    minHeight: 44,
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
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primarySoft,
  },
  success: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  warning: {
    backgroundColor: colors.warning,
    borderColor: colors.warning,
  },
  danger: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  outline: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.borderStrong,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  disabled: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
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
