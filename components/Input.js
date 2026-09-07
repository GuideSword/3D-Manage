import React, { memo, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SPACING, TYPOGRAPHY } from '../constants';
import { useAppTheme } from '../context/ThemeContext';

const Input = memo(({
  label,
  placeholder,
  value,
  onChangeText,
  error,
  multiline = false,
  numberOfLines = 1,
  keyboardType = 'default',
  secureTextEntry = false,
  style,
  inputStyle,
  onFocus,
  onBlur,
  ...props
}) => {
  const [focused, setFocused] = useState(false);
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={[styles.container, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        style={[
          styles.input,
          focused && styles.focusedInput,
          multiline && styles.multilineInput,
          error && styles.errorInput,
          inputStyle,
        ]}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        numberOfLines={multiline ? numberOfLines : 1}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        {...props}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
});

const createStyles = (colors) => StyleSheet.create({
  container: {
    marginVertical: SPACING.sm,
  },
  label: {
    ...TYPOGRAPHY.meta,
    color: colors.text,
    marginBottom: SPACING.xs,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 15,
    paddingHorizontal: SPACING.md,
    paddingVertical: 11,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
    backgroundColor: colors.surfaceElevated,
  },
  focusedInput: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceElevated,
  },
  multilineInput: {
    minHeight: 96,
    textAlignVertical: 'top',
    paddingTop: SPACING.md,
  },
  errorInput: {
    borderColor: colors.danger,
  },
  errorText: {
    ...TYPOGRAPHY.caption,
    color: colors.danger,
    marginTop: SPACING.xs,
  },
});

export default Input;
