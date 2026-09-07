import React, { useMemo } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SPACING } from '../../constants';
import { useAppTheme } from '../../context/ThemeContext';

const SearchBar = ({
  value,
  onChangeText,
  placeholder = '搜索…',
  onClear,
  style,
  inputStyle,
  ...props
}) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const handleClear = onClear || (() => onChangeText?.(''));

  return (
    <View style={[styles.container, style]}>
      <Ionicons name="search" size={19} color={colors.textTertiary} />
      <TextInput
        style={[styles.input, inputStyle]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        returnKeyType="search"
        {...props}
      />
      {value ? (
        <TouchableOpacity
          accessibilityLabel="清除搜索"
          accessibilityRole="button"
          activeOpacity={0.72}
          style={styles.clearButton}
          onPress={handleClear}
        >
          <Ionicons name="close" size={17} color={colors.textSecondary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const createStyles = (colors) => StyleSheet.create({
  container: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingLeft: SPACING.md,
    paddingRight: SPACING.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surfaceElevated,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 11,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  clearButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SearchBar;
