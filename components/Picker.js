import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RADIUS, SPACING, TYPOGRAPHY } from '../constants';
import { useAppTheme } from '../context/ThemeContext';

const Picker = ({
  label,
  placeholder = '请选择',
  value,
  onValueChange,
  options = [],
  style,
  disabled = false,
  error,
}) => {
  const [modalVisible, setModalVisible] = useState(false);
  const { colors, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(colors, shadows), [colors, shadows]);
  const selectedOption = options.find((opt) => opt.value === value);
  const displayText = selectedOption ? selectedOption.label : placeholder;

  const handleSelect = (option) => {
    onValueChange(option.value);
    setModalVisible(false);
  };

  return (
    <View style={[styles.container, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        activeOpacity={0.82}
        style={[
          styles.picker,
          error && styles.errorPicker,
          disabled && styles.disabled,
        ]}
        onPress={() => !disabled && setModalVisible(true)}
        disabled={disabled}
      >
        <Text
          style={[
            styles.pickerText,
            !selectedOption && styles.placeholderText,
          ]}
          numberOfLines={1}
        >
          {displayText}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback onPress={(event) => event.stopPropagation()}>
              <View style={styles.modalContent}>
                <View style={styles.modalHandle} />
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{label || '请选择'}</Text>
                  <TouchableOpacity
                    style={styles.closeButton}
                    onPress={() => setModalVisible(false)}
                  >
                    <Ionicons name="close" size={20} color={colors.text} />
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={options}
                  keyExtractor={(item) => String(item.value)}
                  renderItem={({ item }) => {
                    const selected = value === item.value;
                    return (
                      <TouchableOpacity
                        activeOpacity={0.78}
                        style={[styles.optionItem, selected && styles.selectedOption]}
                        onPress={() => handleSelect(item)}
                      >
                        <Text
                          style={[
                            styles.optionText,
                            selected && styles.selectedOptionText,
                          ]}
                          numberOfLines={1}
                        >
                          {item.label}
                        </Text>
                        {selected ? (
                          <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                        ) : null}
                      </TouchableOpacity>
                    );
                  }}
                />
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
};

const createStyles = (colors, shadows) => StyleSheet.create({
  container: {
    marginVertical: SPACING.sm,
  },
  label: {
    ...TYPOGRAPHY.meta,
    color: colors.text,
    marginBottom: SPACING.xs,
  },
  picker: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 15,
    paddingHorizontal: SPACING.md,
    backgroundColor: colors.surfaceElevated,
  },
  disabled: {
    backgroundColor: colors.surface,
    opacity: 0.72,
  },
  errorPicker: {
    borderColor: colors.danger,
  },
  pickerText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  placeholderText: {
    color: colors.textTertiary,
  },
  errorText: {
    ...TYPOGRAPHY.caption,
    color: colors.danger,
    marginTop: SPACING.xs,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalContent: {
    maxHeight: '72%',
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: SPACING.sm,
    ...shadows.floating,
  },
  modalHandle: {
    width: 42,
    height: 4,
    borderRadius: RADIUS.pill,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  modalHeader: {
    minHeight: 54,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    ...TYPOGRAPHY.sectionTitle,
    color: colors.text,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  optionItem: {
    minHeight: 50,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  selectedOption: {
    backgroundColor: colors.primarySoft,
  },
  optionText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  selectedOptionText: {
    fontWeight: '700',
    color: colors.primaryDark,
  },
});

export default Picker;
