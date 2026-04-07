import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants';

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

  const selectedOption = options.find((opt) => opt.value === value);
  const displayText = selectedOption ? selectedOption.label : placeholder;

  const handleSelect = (option) => {
    onValueChange(option.value);
    setModalVisible(false);
  };

  return (
    <View style={[styles.container, style]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TouchableOpacity
        style={[styles.picker, error && styles.errorPicker, disabled && styles.disabled]}
        onPress={() => !disabled && setModalVisible(true)}
        disabled={disabled}
      >
        <Text style={[styles.pickerText, !selectedOption && styles.placeholderText]}>
          {displayText}
        </Text>
        <Ionicons name="chevron-down" size={20} color={COLORS.textSecondary} />
      </TouchableOpacity>
      {error && <Text style={styles.errorText}>{error}</Text>}

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{label || '请选择'}</Text>
                  <TouchableOpacity onPress={() => setModalVisible(false)}>
                    <Ionicons name="close" size={24} color={COLORS.text} />
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={options}
                  keyExtractor={(item) => String(item.value)}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.optionItem,
                        value === item.value && styles.selectedOption,
                      ]}
                      onPress={() => handleSelect(item)}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          value === item.value && styles.selectedOptionText,
                        ]}
                      >
                        {item.label}
                      </Text>
                      {value === item.value && (
                        <Ionicons name="checkmark" size={20} color={COLORS.primary} />
                      )}
                    </TouchableOpacity>
                  )}
                />
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
};

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
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    backgroundColor: COLORS.background,
  },
  disabled: {
    opacity: 0.5,
  },
  errorPicker: {
    borderColor: COLORS.danger,
  },
  pickerText: {
    fontSize: 16,
    color: COLORS.text,
    flex: 1,
  },
  placeholderText: {
    color: COLORS.textSecondary,
  },
  errorText: {
    fontSize: 14,
    color: COLORS.danger,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  optionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  selectedOption: {
    backgroundColor: COLORS.primary + '10',
  },
  optionText: {
    fontSize: 16,
    color: COLORS.text,
  },
  selectedOptionText: {
    fontWeight: '600',
    color: COLORS.primary,
  },
});

export default Picker;

