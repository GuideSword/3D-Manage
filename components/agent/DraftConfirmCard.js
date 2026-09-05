import React, { useState, useEffect } from 'react';
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

// Draft confirmation card.
//
// The Agent returns a 'draft' event with the order fields it has
// extracted from the user's text. This card lets the user correct
// any field (especially those listed in missing_fields) and then
// either cancel or confirm-and-create.

export default function DraftConfirmCard({ draft, onConfirm, onCancel }) {
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
        label="客户名"
        value={editing.customer_name}
        onChange={(v) => update('customer_name', v)}
        required={isMissing('customer_name')}
      />
      <DateField
        label="交期"
        value={editing.due_date}
        onChange={(v) => update('due_date', v)}
        required={isMissing('due_date')}
      />
      <Field
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
                value={item.material_type || ''}
                onChangeText={(v) => updateItem(idx, 'material_type', v)}
              />
            </View>
            <View style={styles.itemCol}>
              <Text style={styles.itemLabel}>数量</Text>
              <TextInput
                style={styles.itemInput}
                value={item.qty != null ? String(item.qty) : ''}
                onChangeText={(v) => updateItem(idx, 'qty', v)}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.itemCol}>
              <Text style={styles.itemLabel}>单价</Text>
              <TextInput
                style={styles.itemInput}
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
        <TouchableOpacity
          style={[styles.btn, styles.confirm]}
          onPress={handleConfirm}
        >
          <Text style={styles.btnText}>确认并创建</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Field({ label, value, onChange, required, placeholder, multiline }) {
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
        multiline={!!multiline}
      />
    </View>
  );
}

// DateField — 看起来像 TextInput，但点击触发系统原生日期选择器
//   - iOS 14+: 内嵌日历（display='inline'）+ 外部"完成"按钮
//   - iOS 13 / Android: 弹窗式 picker，选完自动关闭
function DateField({ label, value, onChange, required }) {
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#E8F5E9',
    marginHorizontal: 8,
    marginVertical: 6,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A5D6A7',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 10,
    color: '#2E7D32',
  },
  field: { marginBottom: 8 },
  label: { fontSize: 12, color: '#555', marginBottom: 2 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  inputRequired: { borderColor: '#E53935' },
  inputMultiline: { minHeight: 60, textAlignVertical: 'top' },
  // DateField specific
  dateTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateText: { fontSize: 14, color: '#000', flex: 1 },
  datePlaceholder: { fontSize: 14, color: '#9CA3AF', flex: 1 },
  dateIcon: { fontSize: 16, marginLeft: 8 },
  pickerWrapper: {
    marginTop: 6,
    backgroundColor: '#fff',
    borderRadius: 6,
    alignItems: 'center',
  },
  iosDoneBtn: {
    backgroundColor: '#5856D6',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 6,
    marginTop: 4,
    marginBottom: 8,
  },
  iosDoneBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  section: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
    color: '#333',
  },
  empty: { fontSize: 12, color: '#888', fontStyle: 'italic' },
  itemRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  itemCol: { flex: 1 },
  itemLabel: { fontSize: 11, color: '#666', marginBottom: 2 },
  itemInput: {
    backgroundColor: '#fff',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  itemText: { fontSize: 13, color: '#444' },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    flexWrap: 'wrap',
    gap: 6,
  },
  meta: { fontSize: 12, color: '#666' },
  missing: { fontSize: 12, color: '#E53935' },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    gap: 8,
  },
  btn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 },
  cancel: { backgroundColor: '#9E9E9E' },
  confirm: { backgroundColor: '#43A047' },
  btnText: { color: '#fff', fontWeight: '600' },
});
