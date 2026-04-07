import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, ORDER_STATUSES, ROUTES } from '../constants';
import { Card, Button, Input, Picker } from '../components';
import { ordersAPI, modelsAPI, materialsAPI } from '../utils/api';

// 颜色选项
const COLOR_OPTIONS = [
  { value: '金色', label: '金色' },
  { value: '红色', label: '红色' },
  { value: '其它颜色', label: '其它颜色' },
];

const CreateOrderScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [models, setModels] = useState([]);
  const [materials, setMaterials] = useState([]);
  
  const [formData, setFormData] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    dueDate: null,
    currency: 'CNY',
    notes: '',
  });
  
  const [items, setItems] = useState([
    { modelId: '', materialType: '', color: '', customColor: '', quantity: '', unitPrice: '' },
  ]);

  // 加载模型和材质列表
  useEffect(() => {
    loadOptions();
  }, []);

  // 当屏幕获得焦点时刷新模型列表（确保从模型管理页面返回时能获取最新数据）
  useFocusEffect(
    useCallback(() => {
      loadOptions();
    }, [])
  );

  const loadOptions = async () => {
    try {
      setLoadingData(true);
      const [modelsData, materialsData] = await Promise.all([
        modelsAPI.getAll().catch(() => []),
        materialsAPI.getAll().catch(() => []),
      ]);
      
      // 直接使用API返回的数据，不合并默认选项
      setModels(modelsData || []);
      
      // 从物料列表中提取材质类型（去重）
      const apiMaterialTypes = Array.from(
        new Set((materialsData || []).map((m) => m.type || m.materialType).filter(Boolean))
      );
      // 保存完整的物料列表用于后续使用
      setMaterials(materialsData && materialsData.length > 0 
        ? materialsData 
        : apiMaterialTypes.map((type) => ({ type, id: type })));
    } catch (error) {
      console.error('加载选项失败:', error);
      // API失败时设置为空数组
      setModels([]);
      setMaterials([]);
    } finally {
      setLoadingData(false);
    }
  };

  // 格式化日期为 YYYY-MM-DD
  const formatDate = (date) => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // 处理日期选择
  const handleDateChange = (event, selectedDate) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selectedDate) {
      setFormData({ ...formData, dueDate: selectedDate });
    }
  };

  // 添加订单项
  const addOrderItem = () => {
    setItems([...items, { modelId: '', materialType: '', color: '', customColor: '', quantity: '', unitPrice: '' }]);
  };

  // 删除订单项
  const removeOrderItem = (index) => {
    if (items.length > 1) {
      const newItems = items.filter((_, i) => i !== index);
      setItems(newItems);
    }
  };

  // 更新订单项
  const updateOrderItem = (index, field, value) => {
    const newItems = [...items];
    newItems[index][field] = value;
    
    // 如果选择颜色为"其它颜色"，保持customColor字段以便用户输入
    // 如果选择其他颜色，清空customColor
    if (field === 'color') {
      if (value === '其它颜色') {
        // 保持customColor字段，用户需要输入
      } else {
        // 选择预设颜色时，清空自定义颜色
        newItems[index].customColor = '';
      }
    }
    
    setItems(newItems);
  };

  // 验证表单
  const validateForm = () => {
    if (!formData.customerName.trim()) {
      Alert.alert('验证失败', '请输入客户名称');
      return false;
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.modelId) {
        Alert.alert('验证失败', `请选择第 ${i + 1} 项的模型`);
        return false;
      }
      if (!item.materialType) {
        Alert.alert('验证失败', `请选择第 ${i + 1} 项的材质类型`);
        return false;
      }
      // 验证颜色：必须选择颜色，如果选择"其它颜色"则必须输入自定义颜色
      if (!item.color) {
        Alert.alert('验证失败', `请选择第 ${i + 1} 项的颜色`);
        return false;
      }
      if (item.color === '其它颜色' && !item.customColor.trim()) {
        Alert.alert('验证失败', `请填写第 ${i + 1} 项的自定义颜色`);
        return false;
      }
      if (!item.quantity || parseFloat(item.quantity) <= 0) {
        Alert.alert('验证失败', `请填写第 ${i + 1} 项的有效数量`);
        return false;
      }
      if (!item.unitPrice || parseFloat(item.unitPrice) <= 0) {
        Alert.alert('验证失败', `请填写第 ${i + 1} 项的有效单价`);
        return false;
      }
    }

    return true;
  };

  // 计算订单总额
  const calculateTotal = () => {
    return items.reduce((total, item) => {
      const quantity = parseFloat(item.quantity) || 0;
      const unitPrice = parseFloat(item.unitPrice) || 0;
      return total + quantity * unitPrice;
    }, 0);
  };

  // 提交订单
  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);

      // 构建订单数据
      const orderItems = items.map((item) => {
        // 查找模型信息
        const model = models.find((m) => m.id === item.modelId || m.name === item.modelId);
        // 材质类型直接使用item.materialType，因为它已经是类型字符串
        const materialType = item.materialType;
        // 确定颜色：如果选择"其它颜色"则使用customColor，否则使用选择的颜色
        const color = item.color === '其它颜色' ? item.customColor.trim() : item.color;
        
        return {
          modelId: item.modelId,
          modelName: model?.name || item.modelId || '',
          materialType: materialType,
          color: color,
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
        status: ORDER_STATUSES.IN_PROGRESS,
      };

      // 提交到API
      const newOrder = await ordersAPI.create(orderData);

      Alert.alert(
        '成功',
        '订单创建成功！',
        [
          {
            text: '查看订单',
            onPress: () => {
              navigation.replace(ROUTES.ORDER_DETAIL, { orderId: newOrder.id });
            },
          },
          {
            text: '返回列表',
            onPress: () => {
              navigation.goBack();
            },
          },
        ]
      );
    } catch (error) {
      console.error('创建订单失败:', error);
      Alert.alert('错误', '创建订单失败，请检查网络连接或稍后重试');
    } finally {
      setLoading(false);
    }
  };

  // 准备模型选项（显示名称和尺寸）
  const modelOptions = models.map((model) => {
    const name = model.name || `模型 ${model.id || '未知'}`;
    const dimensions = model.dimensions || '';
    // 如果有尺寸信息，在标签中显示；否则只显示名称
    const label = dimensions ? `${name} (${dimensions})` : name;
    return {
      value: model.id || model.name,
      label: label,
    };
  });

  // 准备材质选项（从物料列表中提取类型，去重）
  const materialOptions = Array.from(
    new Set(
      materials
        .map((material) => {
          // 如果material是对象，提取type字段；如果是字符串，直接使用
          const type = typeof material === 'string' 
            ? material 
            : (material.type || material.materialType);
          return type;
        })
        .filter(Boolean) // 过滤掉空值
    )
  ).map((type) => ({
    value: type,
    label: type,
  }));

  if (loadingData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
        {/* 客户信息 */}
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

        {/* 订单信息 */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>订单信息</Text>
          
          {/* 截止日期选择器 */}
          <View style={styles.datePickerContainer}>
            <Text style={styles.label}>截止日期</Text>
            <TouchableOpacity
              style={styles.datePickerButton}
              onPress={() => setShowDatePicker(true)}
            >
              <Text style={[styles.datePickerText, !formData.dueDate && styles.placeholderText]}>
                {formData.dueDate ? formatDate(formData.dueDate) : '请选择截止日期'}
              </Text>
              <Ionicons name="calendar-outline" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
            {formData.dueDate && (
              <TouchableOpacity
                style={styles.clearDateButton}
                onPress={() => setFormData({ ...formData, dueDate: null })}
              >
                <Ionicons name="close-circle" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {showDatePicker && (
            <DateTimePicker
              value={formData.dueDate || new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleDateChange}
              minimumDate={new Date()}
            />
          )}

          <Input
            label="备注"
            placeholder="订单备注信息"
            value={formData.notes}
            onChangeText={(text) => setFormData({ ...formData, notes: text })}
            multiline
            numberOfLines={3}
          />
        </Card>

        {/* 订单项 */}
        <Card style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>订单项目</Text>
            <TouchableOpacity onPress={addOrderItem} style={styles.addButton}>
              <Ionicons name="add-circle" size={24} color={COLORS.primary} />
            </TouchableOpacity>
          </View>

          {items.map((item, index) => (
            <View key={index} style={styles.orderItem}>
              <View style={styles.orderItemHeader}>
                <Text style={styles.orderItemTitle}>项目 {index + 1}</Text>
                {items.length > 1 && (
                  <TouchableOpacity onPress={() => removeOrderItem(index)}>
                    <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                  </TouchableOpacity>
                )}
              </View>

              {/* 模型选择 */}
              <Picker
                label="模型 *"
                placeholder="请选择模型"
                value={item.modelId}
                onValueChange={(value) => updateOrderItem(index, 'modelId', value)}
                options={modelOptions}
              />

              {/* 材质类型选择 */}
              <Picker
                label="材质类型 *"
                placeholder="请选择材质类型"
                value={item.materialType}
                onValueChange={(value) => updateOrderItem(index, 'materialType', value)}
                options={materialOptions}
              />

              {/* 颜色选择 */}
              <Picker
                label="颜色 *"
                placeholder="请选择颜色"
                value={item.color}
                onValueChange={(value) => updateOrderItem(index, 'color', value)}
                options={COLOR_OPTIONS}
              />
              
              {/* 当选择"其它颜色"时，显示自定义颜色输入框 */}
              {item.color === '其它颜色' && (
                <Input
                  label="请输入颜色 *"
                  placeholder="请输入颜色名称"
                  value={item.customColor}
                  onChangeText={(text) => updateOrderItem(index, 'customColor', text)}
                />
              )}
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

        {/* 订单总额 */}
        <Card style={styles.section}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>订单总额</Text>
            <Text style={styles.totalAmount}>
              {formData.currency} {calculateTotal().toFixed(2)}
            </Text>
          </View>
        </Card>

        {/* 提交按钮 */}
        <View style={styles.buttonContainer}>
          <Button
            title={loading ? '创建中...' : '创建订单'}
            onPress={handleSubmit}
            disabled={loading}
            loading={loading}
            style={styles.submitButton}
          />
          <Button
            title="取消"
            onPress={() => navigation.goBack()}
            variant="outline"
            style={styles.cancelButton}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  section: {
    margin: 16,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 4,
  },
  datePickerContainer: {
    marginVertical: 8,
    position: 'relative',
  },
  datePickerButton: {
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
  datePickerText: {
    fontSize: 16,
    color: COLORS.text,
    flex: 1,
  },
  placeholderText: {
    color: COLORS.textSecondary,
  },
  clearDateButton: {
    marginLeft: 8,
    padding: 4,
  },
  addButton: {
    padding: 4,
  },
  orderItem: {
    marginBottom: 24,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  orderItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  orderItemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  rowInputs: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  halfInput: {
    width: '48%',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  totalAmount: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  buttonContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  submitButton: {
    marginBottom: 12,
  },
  cancelButton: {
    marginTop: 0,
  },
});

export default CreateOrderScreen;
