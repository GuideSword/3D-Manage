import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useAppTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { canWrite } from '../../utils/permissions';

// Draft confirmation card.
//
// The Agent returns a 'draft' event with the order fields it has
// extracted from the user's text. This card lets the user correct
// any field (especially those listed in missing_fields) and then
// either cancel or confirm-and-create.

export default function DraftConfirmCard({ draft, onConfirm, onCancel }) {
  const { colors, isDark } = useAppTheme();
  const { user } = useAuth();
  const allowConfirm = canWrite(user);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [editing, setEditing] = useState(draft);

  // If the parent swaps in a new draft, reset local state.
  useEffect(() => {
    setEditing(draft);
  }, [draft]);

  const missing = (editing && editing.missing_fields) || [];
  const isMissing = (key) => missing.includes(key);

  const update = (key, val) =>
    setEditing((prev) => ({ ...(prev || {}), [key]: val }));

  const updateItem = (idx, key, val) => {
    setEditing((prev) => {
      const items = Array.isArray(prev?.items) ? [...prev.items] : [];
      if (!items[idx]) return prev;
      items[idx] = { ...items[idx], [key]: val };
      return { ...prev, items };
    });
  };

  const handleConfirm = () => {
    if (!editing) return;
    // Block submit while required fields are still missing.
    if (missing.length > 0) {
      Alert.alert(
        '缺少必填字段',
        `请补全：${missing.join('、')}`
      );
      return;
    }
    Alert.alert(
      '确认创建订单',
      '将根据以上信息创建草稿订单，继续？',
      [
        { text: '取消', style: 'cancel' },
        { text: '确认', onPress: () => onConfirm?.(editing) },
      ]
    );
  };

  if (!editing) return null;

  const items = Array.isArray(editing.items) ? editing.items : [];
  const confidencePct = Math.round((editing.confidence || 0) * 100);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>📝 抽取的订单草稿</Text>

      <Field
        styles={styles}
        colors={colors}
        label="客户名"
        value={editing.customer_name}
        onChange={(v) => update('customer_name', v)}
        required={isMissing('customer_name')}
      />
      <DateField
        styles={styles}
        isDark={isDark}
        label="交期"
        value={editing.due_date}
        onChange={(v) => update('due_date', v)}
        required={isMissing('due_date')}
      />
      <Field
        styles={styles}
        colors={colors}
        label="备注"
        value={editing.notes}
        onChange={(v) => update('notes', v)}
        multiline
      />

      <Text style={styles.section}>订单行（{items.length}）</Text>
      {items.length === 0 ? (
        <Text style={styles.empty}>— 无订单行 —</Text>
      ) : (
        items.map((item, idx) => (
          <View key={idx} style={styles.itemRow}>
            <View style={styles.itemCol}>
              <Text style={styles.itemLabel}>材质</Text>
              <TextInput
                style={styles.itemInput}
                placeholderTextColor={colors.textTertiary}
                value={item.material_type || ''}
                onChangeText={(v) => updateItem(idx, 'material_type', v)}
              />
            </View>
            <View style={styles.itemCol}>
              <Text style={styles.itemLabel}>数量</Text>
              <TextInput
                style={styles.itemInput}
                placeholderTextColor={colors.textTertiary}
                value={item.qty != null ? String(item.qty) : ''}
                onChangeText={(v) => updateItem(idx, 'qty', v)}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.itemCol}>
              <Text style={styles.itemLabel}>单价</Text>
              <TextInput
                style={styles.itemInput}
                placeholderTextColor={colors.textTertiary}
                value={item.unit_price != null ? String(item.unit_price) : ''}
                onChangeText={(v) => updateItem(idx, 'unit_price', v)}
                keyboardType="numeric"
              />
            </View>
          </View>
        ))
      )}

      <View style={styles.metaRow}>
        <Text style={styles.meta}>置信度：{confidencePct}%</Text>
        {missing.length > 0 ? (
          <Text style={styles.missing}>⚠ 缺失：{missing.join(', ')}</Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, styles.cancel]}
          onPress={() => onCancel?.()}
        >
          <Text style={styles.btnText}>取消</Text>
        </TouchableOpacity>
        {allowConfirm ? (
          <TouchableOpacity
            style={[styles.btn, styles.confirm]}
            onPress={handleConfirm}
          >
            <Text style={styles.btnText}>确认并创建</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.readOnly}>Viewer 仅可查看草稿</Text>
        )}
      </View>
    </View>
  );
}

function Field({ label, value, onChange, required, placeholder, multiline, styles, colors }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? ' *' : ''}
      </Text>
      <TextInput
        style={[
          styles.input,
          required && styles.inputRequired,
          multiline && styles.inputMultiline,
        ]}
        value={value != null ? String(value) : ''}
        onChangeText={onChange}
        placeholder={required ? '必填' : placeholder || ''}
        placeholderTextColor={colors.textTertiary}
        multiline={!!multiline}
      />
    </View>
  );
}

// DateField — 看起来像 TextInput，但点击触发系统原生日期选择器
//   - iOS 14+: 内嵌日历（display='inline'）+ 外部"完成"按钮
//   - iOS 13 / Android: 弹窗式 picker，选完自动关闭
function DateField({ label, value, onChange, required, styles, isDark }) {
  const [showPicker, setShowPicker] = useState(false);

  // 解析当前值；解析失败则 fallback 到今天
  const initialDate = (() => {
    if (!value) return new Date();
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date() : d;
  })();

  const handleChange = (event, selectedDate) => {
    // Android: dialog 模式下 'set' 表示确认，'dismissed' 表示取消
    if (Platform.OS === 'android') {
      setShowPicker(false);
    }
    if (event?.type === 'dismissed' || !selectedDate) return;
    const yyyy = selectedDate.getFullYear();
    const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const dd = String(selectedDate.getDate()).padStart(2, '0');
    onChange(`${yyyy}-${mm}-${dd}`);
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? ' *' : ''}
      </Text>
      <TouchableOpacity
        style={[styles.input, styles.dateTrigger, required && styles.inputRequired]}
        onPress={() => setShowPicker(true)}
        activeOpacity={0.7}
      >
        <Text style={value ? styles.dateText : styles.datePlaceholder}>
          {value || (required ? '必填 · 点击选择日期' : '点击选择日期')}
        </Text>
        <Text style={styles.dateIcon}>📅</Text>
      </TouchableOpacity>

      {showPicker && (
        <View style={styles.pickerWrapper}>
          <DateTimePicker
            value={initialDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={handleChange}
            themeVariant={isDark ? 'dark' : 'light'}
          />
          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={styles.iosDoneBtn}
              onPress={() => setShowPicker(false)}
            >
              <Text style={styles.iosDoneBtnText}>完成</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.successSoft,
    marginHorizontal: 8,
    marginVertical: 6,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.success,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 10,
    color: colors.success,
  },
  field: { marginBottom: 8 },
  label: { fontSize: 12, color: colors.textSecondary, marginBottom: 2 },
  input: {
    backgroundColor: colors.surfaceElevated,
    color: colors.text,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputRequired: { borderColor: colors.danger },
  inputMultiline: { minHeight: 60, textAlignVertical: 'top' },
  // DateField specific
  dateTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateText: { fontSize: 14, color: colors.text, flex: 1 },
  datePlaceholder: { fontSize: 14, color: colors.textTertiary, flex: 1 },
  dateIcon: { fontSize: 16, marginLeft: 8 },
  pickerWrapper: {
    marginTop: 6,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 6,
    alignItems: 'center',
  },
  iosDoneBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 6,
    marginTop: 4,
    marginBottom: 8,
  },
  iosDoneBtnText: { color: colors.onPrimary, fontWeight: '600', fontSize: 14 },
  section: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
    color: colors.text,
  },
  empty: { fontSize: 12, color: colors.textTertiary, fontStyle: 'italic' },
  itemRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  itemCol: { flex: 1 },
  itemLabel: { fontSize: 11, color: colors.textSecondary, marginBottom: 2 },
  itemInput: {
    backgroundColor: colors.surfaceElevated,
    color: colors.text,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontSize: 13,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemText: { fontSize: 13, color: colors.text },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    flexWrap: 'wrap',
    gap: 6,
  },
  meta: { fontSize: 12, color: colors.textSecondary },
  missing: { fontSize: 12, color: colors.danger },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    gap: 8,
  },
  btn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 },
  cancel: { backgroundColor: colors.textTertiary },
  confirm: { backgroundColor: colors.success },
  btnText: { color: colors.onSuccess, fontWeight: '600' },
  readOnly: { color: colors.textSecondary, fontSize: 12, alignSelf: 'center' },
});
