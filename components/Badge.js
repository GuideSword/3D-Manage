import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../constants';

const Badge = ({
  text,
  color = COLORS.primary,
  variant = 'filled', // filled, outline
  size = 'medium', // small, medium, large
  style,
  textStyle,
  ...props
}) => {
  const getContainerStyle = () => {
    const baseStyle = [styles.container];

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
    if (variant === 'outline') {
      baseStyle.push(styles.outline);
    } else {
      baseStyle.push({ backgroundColor: color });
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

    if (variant === 'outline') {
      baseStyle.push({ color });
    } else {
      baseStyle.push(styles.filledText);
    }

    baseStyle.push(textStyle);
    return baseStyle;
  };

  return (
    <View style={getContainerStyle()} {...props}>
      <Text style={getTextStyle()}>{text}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 尺寸
  small: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    minHeight: 20,
  },
  medium: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 24,
  },
  large: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 28,
  },

  // 变体
  outline: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'transparent',
  },

  // 文字样式
  text: {
    fontWeight: '500',
    textAlign: 'center',
  },
  smallText: {
    fontSize: 12,
  },
  mediumText: {
    fontSize: 14,
  },
  largeText: {
    fontSize: 16,
  },
  filledText: {
    color: COLORS.background,
  },
});

export default Badge;


