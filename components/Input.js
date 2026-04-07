import React, { memo } from 'react';
import { View, TextInput, Text, StyleSheet } from 'react-native';
import { COLORS } from '../constants';

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
  ...props
}) => {
  return (
    <View style={[styles.container, style]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={[
          styles.input,
          multiline && styles.multilineInput,
          error && styles.errorInput,
          inputStyle,
        ]}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textSecondary}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        numberOfLines={multiline ? numberOfLines : 1}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        {...props}
      />
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.background,
    minHeight: 44,
  },
  multilineInput: {
    textAlignVertical: 'top',
    paddingTop: 10,
  },
  errorInput: {
    borderColor: COLORS.danger,
  },
  errorText: {
    fontSize: 14,
    color: COLORS.danger,
    marginTop: 4,
  },
});

export default Input;


