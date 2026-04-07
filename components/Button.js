import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { COLORS } from '../constants';

const Button = ({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  style,
  textStyle,
  ...props
}) => {
  const getButtonStyle = () => {
    const baseStyle = [styles.button];

    // 尺寸样式
    switch (size) {
      case 'small':
        baseStyle.push(styles.small);
        break;
      case 'large':
        baseStyle.push(styles.large);
        break;
      default:
        baseStyle.push(styles.medium);
    }

    // 变体样式
    switch (variant) {
      case 'secondary':
        baseStyle.push(styles.secondary);
        break;
      case 'success':
        baseStyle.push(styles.success);
        break;
      case 'warning':
        baseStyle.push(styles.warning);
        break;
      case 'danger':
        baseStyle.push(styles.danger);
        break;
      case 'outline':
        baseStyle.push(styles.outline);
        break;
      default:
        baseStyle.push(styles.primary);
    }

    if (disabled || loading) {
      baseStyle.push(styles.disabled);
    }

    baseStyle.push(style);
    return baseStyle;
  };

  const getTextStyle = () => {
    const baseStyle = [styles.text];

    switch (size) {
      case 'small':
        baseStyle.push(styles.smallText);
        break;
      case 'large':
        baseStyle.push(styles.largeText);
        break;
      default:
        baseStyle.push(styles.mediumText);
    }

    switch (variant) {
      case 'outline':
        baseStyle.push(styles.outlineText);
        break;
      default:
        baseStyle.push(styles.defaultText);
    }

    baseStyle.push(textStyle);
    return baseStyle;
  };

  return (
    <TouchableOpacity
      style={getButtonStyle()}
      onPress={disabled || loading ? undefined : onPress}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'outline' ? COLORS.primary : COLORS.background}
        />
      ) : (
        <Text style={getTextStyle()}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },

  // 尺寸
  small: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 32,
  },
  medium: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
  },
  large: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    minHeight: 52,
  },

  // 变体
  primary: {
    backgroundColor: COLORS.primary,
  },
  secondary: {
    backgroundColor: COLORS.secondary,
  },
  success: {
    backgroundColor: COLORS.success,
  },
  warning: {
    backgroundColor: COLORS.warning,
  },
  danger: {
    backgroundColor: COLORS.danger,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },

  disabled: {
    opacity: 0.5,
  },

  // 文字样式
  text: {
    fontWeight: '600',
    textAlign: 'center',
  },
  smallText: {
    fontSize: 14,
  },
  mediumText: {
    fontSize: 16,
  },
  largeText: {
    fontSize: 18,
  },
  defaultText: {
    color: COLORS.background,
  },
  outlineText: {
    color: COLORS.primary,
  },
});

export default Button;


