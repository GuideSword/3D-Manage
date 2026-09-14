import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { useAppTheme } from '../../context/ThemeContext';

const OPTIONS = [
  { value: 'system', label: '跟随系统', icon: 'phone-portrait-outline' },
  { value: 'light', label: '日间', icon: 'sunny-outline' },
  { value: 'dark', label: '夜间', icon: 'moon-outline' },
];

const ThemeModePicker = ({ value, onChange, style }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View accessibilityRole="radiogroup" style={[styles.container, style]}>
      {OPTIONS.map((option) => {
        const selected = value === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange?.(option.value)}
            style={({ pressed }) => [
              styles.option,
              selected && styles.selectedOption,
              pressed && styles.pressedOption,
            ]}
          >
            <Ionicons
              name={option.icon}
              size={18}
              color={selected ? colors.primaryDark : colors.textSecondary}
            />
            <Text style={[styles.label, selected && styles.selectedLabel]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const createStyles = (colors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: SPACING.xs,
    padding: SPACING.xs,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  option: {
    minHeight: 44,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: SPACING.sm,
    borderRadius: 14,
  },
  selectedOption: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  pressedOption: {
    opacity: 0.78,
  },
  label: {
    ...TYPOGRAPHY.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  selectedLabel: {
    color: colors.primaryDark,
  },
});

export default ThemeModePicker;
