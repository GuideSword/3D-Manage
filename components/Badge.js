import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY } from '../constants';
import { useAppTheme } from '../context/ThemeContext';

const Badge = ({
  text,
  color,
  variant = 'soft',
  size = 'medium',
  style,
  textStyle,
  ...props
}) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(), []);
  const resolvedColor = color || colors.primary;

  return (
    <View
      style={[
        styles.container,
        styles[size] || styles.medium,
        getVariantStyle(variant, resolvedColor),
        style,
      ]}
      {...props}
    >
      <Text
        style={[
          styles.text,
          styles[`${size}Text`] || styles.mediumText,
          getTextStyle(variant, resolvedColor, colors),
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
  return { backgroundColor: withAlpha(color, 0.1), borderColor: withAlpha(color, 0.18) };
};

const getTextStyle = (variant, color, colors) => {
  if (variant === 'filled') {
    if (color === colors.danger) return { color: colors.onDanger };
    if (color === colors.warning) return { color: colors.onWarning };
    if (color === colors.success) return { color: colors.onSuccess };
    if (color === colors.accent) return { color: colors.onAccent };
    return { color: colors.onPrimary };
  }
  return { color };
};

const withAlpha = (color, alpha) => {
  const hex = color?.replace('#', '');
  if (!hex || ![3, 6].includes(hex.length)) return color;
  const normalized = hex.length === 3
    ? hex.split('').map((character) => character + character).join('')
    : hex;
  const number = parseInt(normalized, 16);
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const createStyles = () => StyleSheet.create({
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
