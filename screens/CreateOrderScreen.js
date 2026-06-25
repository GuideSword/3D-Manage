import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import {
  COLORS,
  ORDER_STATUSES,
  RADIUS,
  ROUTES,
  SPACING,
  TYPOGRAPHY,
} from '../constants';
import { Button, Card, Input, Picker } from '../components';
import { isAuthRequiredError, materialsAPI, modelsAPI, ordersAPI } from '../utils/api';
import { pickerAssetToFormFile, validateExtension } from '../utils/upload';

const COLOR_OPTIONS = [
  { value: '金色', label: '金色' },
  { value: '红色', label: '红色' },
  { value: '其它颜色', label: '其它颜色' },
];

const newOrderItem = () => ({
  modelId: '',
  materialType: '',
  color: '',
  customColor: '',
  quantity: '',
  unitPrice: '',
});

const CreateOrderScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [models, setModels] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [selectedAttachment, setSelectedAttachment] = useState(null);
  const [formData, setFormData] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    dueDate: null,
    currency: 'CNY',
    notes: '',
  });
  const [items, setItems] = useState([newOrderItem()]);

  useEffect(() => {
    loadOptions();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadOptions();
    }, [])
  );

  const loadOptions = async () => {
    try {
      setLoadingData(true);
      const [modelsData, materialsData] = await Promise.all([
        modelsAPI.getAll().catch((error) => {
          if (isAuthRequiredError(error)) throw error;
          return [];
        }),
        materialsAPI.getAll().catch((error) => {
          if (isAuthRequiredError(error)) throw error;
          return [];
        }),
      ]);
      setModels(modelsData || []);
      const apiMaterialTypes = Array.from(
        new Set((materialsData || []).map((material) => material.type || material.materialType).filter(Boolean))
      );
      setMaterials(
        materialsData && materialsData.length > 0
          ? materialsData
          : apiMaterialTypes.map((type) => ({ type, id: type }))
      );
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      console.error('加载选项失败:', error);
      setModels([]);
      setMaterials([]);
    } finally {
      setLoadingData(false);
    }
  };

  const pickAttachment = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/png', 'image/jpeg', 'application/pdf'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        return;
      }
      const asset = result.assets?.[0];
      if (!validateExtension(asset, ['png', 'jpg', 'jpeg', 'pdf'])) {
        Alert.alert('文件格式不支持', '请选择 PNG、JPG、JPEG 或 PDF 附件');
        return;
      }
      setSelectedAttachment(asset);
    } catch (error) {
      Alert.alert('错误', '选择附件失败');
    }
  };

  const formatDate = (date) => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const handleDateChange = (event, selectedDate) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selectedDate) {
      setFormData({ ...formData, dueDate: selectedDate });
    }
  };

  const addOrderItem = () => {
    setItems([...items, newOrderItem()]);
  };

  const removeOrderItem = (index) => {
    if (items.length > 1) {
      setItems(items.filter((_, itemIndex) => itemIndex !== index));
    }
  };

  const updateOrderItem = (index, field, value) => {
    const newItems = [...items];
    newItems[index][field] = value;
    if (field === 'color' && value !== '其它颜色') {
      newItems[index].customColor = '';
    }
    setItems(newItems);
  };

  const validateForm = () => {
    if (!formData.customerName.trim()) {
      Alert.alert('验证失败', '请输入客户名称');
      return false;
    }

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const itemNumber = index + 1;
      if (!item.modelId) {
        Alert.alert('验证失败', `请选择第 ${itemNumber} 项的模型`);
        return false;
      }
      if (!item.materialType) {
        Alert.alert('验证失败', `请选择第 ${itemNumber} 项的材质类型`);
        return false;
      }
      if (!item.color) {
        Alert.alert('验证失败', `请选择第 ${itemNumber} 项的颜色`);
        return false;
      }
      if (item.color === '其它颜色' && !item.customColor.trim()) {
        Alert.alert('验证失败', `请填写第 ${itemNumber} 项的自定义颜色`);
        return false;
      }
      if (!item.quantity || parseFloat(item.quantity) <= 0) {
        Alert.alert('验证失败', `请填写第 ${itemNumber} 项的有效数量`);
        return false;
      }
      if (!item.unitPrice || parseFloat(item.unitPrice) <= 0) {
        Alert.alert('验证失败', `请填写第 ${itemNumber} 项的有效单价`);
        return false;
      }
    }

    return true;
  };

  const calculateTotal = () => (
    items.reduce((total, item) => {
      const quantity = parseFloat(item.quantity) || 0;
      const unitPrice = parseFloat(item.unitPrice) || 0;
      return total + quantity * unitPrice;
    }, 0)
  );

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      const attachments = [];
      if (selectedAttachment) {
        const uploadResult = await ordersAPI.uploadAttachment(pickerAssetToFormFile(selectedAttachment));
        attachments.push({
          fileKey: uploadResult.fileKey,
          fileUrl: uploadResult.fileUrl,
          sha256: uploadResult.sha256,
          size: uploadResult.size,
          originalName: uploadResult.originalName || selectedAttachment.name,
        });
      }

      const orderItems = items.map((item) => {
        const model = models.find((entry) => entry.id === item.modelId || entry.name === item.modelId);
        const color = item.color === '其它颜色' ? item.customColor.trim() : item.color;
        return {
          modelId: item.modelId,
          modelName: model?.name || item.modelId || '',
          materialType: item.materialType,
          color,
          quantity: parseFloat(item.quantity),
          unitPrice: parseFloat(item.unitPrice),
        };
      });

      const orderData = {
        customer: {
          name: formData.customerName.trim(),
          email: formData.customerEmail.trim() || undefined,
          phone: formData.customerPhone.trim() || undefined,
        },
        items: orderItems,
        total: calculateTotal(),
        currency: formData.currency,
        dueDate: formData.dueDate ? formatDate(formData.dueDate) : undefined,
        notes: formData.notes.trim() || undefined,
        attachments,
        status: ORDER_STATUSES.PENDING_REVIEW,
      };

      const newOrder = await ordersAPI.create(orderData);

      Alert.alert('成功', '订单创建成功', [
        {
          text: '查看订单',
          onPress: () => navigation.replace(ROUTES.ORDER_DETAIL, { orderId: newOrder.id }),
        },
        { text: '返回列表', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      console.error('创建订单失败:', error);
      Alert.alert('错误', '创建订单失败，请检查网络连接或稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const modelOptions = models.map((model) => {
    const name = model.name || `模型 ${model.id || '未知'}`;
    const dimensions = model.dimensions || '';
    return {
      value: model.id || model.name,
      label: dimensions ? `${name} (${dimensions})` : name,
    };
  });

  const materialOptions = Array.from(
    new Set(
      materials
        .map((material) => (typeof material === 'string' ? material : (material.type || material.materialType)))
        .filter(Boolean)
    )
  ).map((type) => ({ value: type, label: type }));

  if (loadingData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>加载选项中...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name="receipt-outline" size={24} color={COLORS.primary} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>NEW ORDER</Text>
            <Text style={styles.title}>新建订单</Text>
            <Text style={styles.subtitle}>录入客户信息、交期、附件和打印项目。</Text>
          </View>
        </View>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>客户信息</Text>
          <Input
            label="客户名称 *"
            placeholder="请输入客户名称"
            value={formData.customerName}
            onChangeText={(text) => setFormData({ ...formData, customerName: text })}
          />
          <Input
            label="客户邮箱"
            placeholder="请输入客户邮箱"
            value={formData.customerEmail}
            onChangeText={(text) => setFormData({ ...formData, customerEmail: text })}
            keyboardType="email-address"
          />
          <Input
            label="客户电话"
            placeholder="请输入客户电话"
            value={formData.customerPhone}
            onChangeText={(text) => setFormData({ ...formData, customerPhone: text })}
            keyboardType="phone-pad"
          />
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>订单信息</Text>
          <View style={styles.datePickerContainer}>
            <Text style={styles.fieldLabel}>截止日期</Text>
            <TouchableOpacity
              activeOpacity={0.82}
              style={styles.datePickerButton}
              onPress={() => setShowDatePicker(true)}
            >
              <Text style={[styles.datePickerText, !formData.dueDate && styles.placeholderText]}>
                {formData.dueDate ? formatDate(formData.dueDate) : '请选择截止日期'}
              </Text>
              <Ionicons name="calendar-outline" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
            {formData.dueDate ? (
              <TouchableOpacity
                activeOpacity={0.82}
                style={styles.clearDateButton}
                onPress={() => setFormData({ ...formData, dueDate: null })}
              >
                <Ionicons name="close" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>

          {showDatePicker ? (
            <DateTimePicker
              value={formData.dueDate || new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleDateChange}
              minimumDate={new Date()}
            />
          ) : null}

          <Input
            label="备注"
            placeholder="订单备注信息"
            value={formData.notes}
            onChangeText={(text) => setFormData({ ...formData, notes: text })}
            multiline
            numberOfLines={3}
          />

          <View style={styles.attachmentBlock}>
            <Text style={styles.fieldLabel}>附件</Text>
            <Text style={styles.helperText}>支持 PNG、JPG、PDF，可上传客户图纸或确认文件。</Text>
            {selectedAttachment ? <SelectedFile asset={selectedAttachment} /> : null}
            <Button
              title={selectedAttachment ? '重新选择附件' : '选择附件'}
              iconLeft="attach-outline"
              onPress={pickAttachment}
              variant="outline"
              fullWidth
            />
          </View>
        </Card>

        <Card style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>订单项目</Text>
            <TouchableOpacity activeOpacity={0.82} onPress={addOrderItem} style={styles.addButton}>
              <Ionicons name="add" size={20} color={COLORS.primary} />
            </TouchableOpacity>
          </View>

          {items.map((item, index) => (
            <View key={index} style={styles.orderItem}>
              <View style={styles.orderItemHeader}>
                <Text style={styles.orderItemTitle}>项目 {index + 1}</Text>
                {items.length > 1 ? (
                  <TouchableOpacity onPress={() => removeOrderItem(index)} style={styles.removeButton}>
                    <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                  </TouchableOpacity>
                ) : null}
              </View>

              <Picker
                label="模型 *"
                placeholder="请选择模型"
                value={item.modelId}
                onValueChange={(value) => updateOrderItem(index, 'modelId', value)}
                options={modelOptions}
              />
              <Picker
                label="材质类型 *"
                placeholder="请选择材质类型"
                value={item.materialType}
                onValueChange={(value) => updateOrderItem(index, 'materialType', value)}
                options={materialOptions}
              />
              <Picker
                label="颜色 *"
                placeholder="请选择颜色"
                value={item.color}
                onValueChange={(value) => updateOrderItem(index, 'color', value)}
                options={COLOR_OPTIONS}
              />
              {item.color === '其它颜色' ? (
                <Input
                  label="请输入颜色 *"
                  placeholder="请输入颜色名称"
                  value={item.customColor}
                  onChangeText={(text) => updateOrderItem(index, 'customColor', text)}
                />
              ) : null}
              <View style={styles.rowInputs}>
                <View style={styles.halfInput}>
                  <Input
                    label="数量 *"
                    placeholder="数量"
                    value={item.quantity}
                    onChangeText={(text) => updateOrderItem(index, 'quantity', text)}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.halfInput}>
                  <Input
                    label="单价 *"
                    placeholder="单价"
                    value={item.unitPrice}
                    onChangeText={(text) => updateOrderItem(index, 'unitPrice', text)}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            </View>
          ))}
        </Card>

        <Card style={styles.totalSection}>
          <Text style={styles.totalLabel}>订单总额</Text>
          <Text style={styles.totalAmount}>
            {formData.currency} {calculateTotal().toFixed(2)}
          </Text>
        </Card>

        <View style={styles.buttonContainer}>
          <Button
            title={loading ? '创建中...' : '创建订单'}
            iconLeft="checkmark-outline"
            onPress={handleSubmit}
            disabled={loading}
            loading={loading}
            fullWidth
            style={styles.submitButton}
          />
          <Button
            title="取消"
            onPress={() => navigation.goBack()}
            variant="outline"
            fullWidth
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const SelectedFile = ({ asset }) => (
  <View style={styles.fileInfo}>
    <Ionicons name="document-text-outline" size={18} color={COLORS.primary} />
    <View style={styles.fileTextGroup}>
      <Text style={styles.fileName} numberOfLines={1}>{asset.name}</Text>
      {asset.size ? <Text style={styles.fileMeta}>{Math.round(asset.size / 1024)} KB</Text> : null}
    </View>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    ...TYPOGRAPHY.caption,
    color: COLORS.primary,
    marginBottom: 2,
  },
  title: {
    ...TYPOGRAPHY.screenTitle,
    color: COLORS.text,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  section: {
    marginHorizontal: 0,
    marginBottom: SPACING.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.text,
  },
  fieldLabel: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  helperText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
  },
  attachmentBlock: {
    marginTop: SPACING.md,
  },
  fileInfo: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
    marginBottom: SPACING.md,
  },
  fileTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
  },
  fileMeta: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  datePickerContainer: {
    marginVertical: SPACING.sm,
    position: 'relative',
  },
  datePickerButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surfaceElevated,
  },
  datePickerText: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
  },
  placeholderText: {
    color: COLORS.textTertiary,
  },
  clearDateButton: {
    position: 'absolute',
    right: 36,
    bottom: 9,
    width: 28,
    height: 28,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceMuted,
  },
  addButton: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
  },
  removeButton: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.dangerSoft,
  },
  orderItem: {
    marginBottom: SPACING.lg,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
  },
  orderItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  orderItemTitle: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
  },
  rowInputs: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  halfInput: {
    flex: 1,
    minWidth: 0,
  },
  totalSection: {
    marginHorizontal: 0,
    marginBottom: SPACING.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.primarySoft,
    borderColor: COLORS.primarySoft,
  },
  totalLabel: {
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.primaryDark,
  },
  totalAmount: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    color: COLORS.primaryDark,
  },
  buttonContainer: {
    marginTop: SPACING.sm,
  },
  submitButton: {
    marginBottom: SPACING.md,
  },
});

export default CreateOrderScreen;
