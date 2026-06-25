import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '../constants';

const Badge = ({
  text,
  color = COLORS.primary,
  variant = 'soft',
  size = 'medium',
  style,
  textStyle,
  ...props
}) => {
  return (
    <View
      style={[
        styles.container,
        styles[size] || styles.medium,
        getVariantStyle(variant, color),
        style,
      ]}
      {...props}
    >
      <Text
        style={[
          styles.text,
          styles[`${size}Text`] || styles.mediumText,
          getTextStyle(variant, color),
          textStyle,
        ]}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
};

const getVariantStyle = (variant, color) => {
  if (variant === 'filled') {
    return { backgroundColor: color, borderColor: color };
  }
  if (variant === 'outline') {
    return { backgroundColor: 'transparent', borderColor: color };
  }
  return { backgroundColor: `${color}18`, borderColor: `${color}24` };
};

const getTextStyle = (variant, color) => {
  if (variant === 'filled') {
    return { color: COLORS.surfaceElevated };
  }
  return { color };
};

const styles = StyleSheet.create({
  container: {
    maxWidth: '100%',
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: {
    minHeight: 22,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
  },
  medium: {
    minHeight: 26,
    paddingHorizontal: SPACING.md,
    paddingVertical: 3,
  },
  large: {
    minHeight: 30,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xs,
  },
  text: {
    fontWeight: '700',
    textAlign: 'center',
  },
  smallText: {
    ...TYPOGRAPHY.caption,
  },
  mediumText: {
    fontSize: 13,
    lineHeight: 18,
  },
  largeText: {
    fontSize: 14,
    lineHeight: 20,
  },
});

export default Badge;
