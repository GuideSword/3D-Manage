import React, { useMemo, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '../constants';
import { Button, Card, Input, Picker } from '../components';
import { isAuthRequiredError, materialsAPI, modelsAPI, ordersAPI, stockAPI } from '../utils/api';
import { validateExtension } from '../utils/upload';

const IMPORT_OPTIONS = [
  { value: 'orders', label: '订单' },
  { value: 'models', label: '模型' },
  { value: 'materials', label: '耗材' },
  { value: 'stockLots', label: '库存批次' },
];

const EXAMPLE_HEADERS = {
  orders: 'customer_name,status,total,currency,due_date,item_model_name,item_material_type,item_color,item_quantity,item_unit_price,notes',
  models: 'name,description,source',
  materials: 'type,brand,diameter,color,density,unit_price,unit,notes',
  stockLots: 'material_id,lot_no,serial_no,location,qty,state,notes',
};

const DataImportScreen = ({ navigation }) => {
  const [importType, setImportType] = useState('orders');
  const [csvText, setCsvText] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [loading, setLoading] = useState(false);

  const currentHeader = useMemo(() => EXAMPLE_HEADERS[importType], [importType]);

  const readAssetText = async (asset) => {
    if (asset.file && typeof asset.file.text === 'function') {
      return asset.file.text();
    }
    return FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  };

  const pickCsvFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/plain', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        return;
      }
      const asset = result.assets?.[0];
      if (!validateExtension(asset, ['csv', 'txt'])) {
        Alert.alert('文件格式不支持', '请选择 CSV 或 TXT 文件');
        return;
      }
      const text = await readAssetText(asset);
      setCsvText(text);
      setSelectedFileName(asset.name || '');
    } catch (error) {
      Alert.alert('错误', '读取 CSV 文件失败');
    }
  };

  const handleImport = async () => {
    if (!csvText.trim()) {
      Alert.alert('验证失败', '请粘贴 CSV 内容或选择 CSV 文件');
      return;
    }

    try {
      setLoading(true);
      let result;
      if (importType === 'orders') {
        result = await ordersAPI.import({ csv: csvText });
      } else if (importType === 'models') {
        result = await modelsAPI.import({ csv: csvText });
      } else if (importType === 'materials') {
        result = await materialsAPI.import({ csv: csvText });
      } else {
        result = await stockAPI.importLots({ csv: csvText });
      }
      Alert.alert('成功', `已导入 ${result.imported || 0} 条数据`, [
        { text: '确定', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      Alert.alert('错误', error.message || '导入失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name="document-attach-outline" size={24} color={COLORS.primary} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>DATA IMPORT</Text>
            <Text style={styles.title}>CSV 数据导入</Text>
            <Text style={styles.subtitle}>选择导入目标后上传文件，或直接粘贴 CSV 内容。</Text>
          </View>
        </View>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>导入目标</Text>
          <Picker
            label="模块"
            value={importType}
            onValueChange={(value) => {
              setImportType(value);
              setSelectedFileName('');
              setCsvText('');
            }}
            options={IMPORT_OPTIONS}
          />
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>CSV 内容</Text>
          <View style={styles.headerBox}>
            <Text style={styles.headerLabel}>示例表头</Text>
            <Text style={styles.headerTextValue}>{currentHeader}</Text>
          </View>
          {selectedFileName ? (
            <View style={styles.fileInfo}>
              <Ionicons name="document-text-outline" size={18} color={COLORS.primary} />
              <Text style={styles.fileName} numberOfLines={1}>{selectedFileName}</Text>
            </View>
          ) : null}
          <Button
            title="选择 CSV 文件"
            iconLeft="folder-open-outline"
            onPress={pickCsvFile}
            variant="outline"
            fullWidth
            style={styles.fileButton}
          />
          <Input
            label="CSV"
            placeholder="粘贴 CSV 内容"
            value={csvText}
            onChangeText={setCsvText}
            multiline
            numberOfLines={10}
            inputStyle={styles.csvInput}
          />
        </Card>

        <View style={styles.buttonContainer}>
          <Button
            title={loading ? '导入中...' : '确认导入'}
            iconLeft="cloud-upload-outline"
            onPress={handleImport}
            loading={loading}
            disabled={loading}
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
  sectionTitle: {
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  headerBox: {
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
    marginBottom: SPACING.md,
  },
  headerLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textTertiary,
    marginBottom: SPACING.xs,
  },
  headerTextValue: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  fileInfo: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primarySoft,
    marginBottom: SPACING.md,
  },
  fileName: {
    flex: 1,
    ...TYPOGRAPHY.meta,
    color: COLORS.primaryDark,
  },
  fileButton: {
    marginBottom: SPACING.md,
  },
  csvInput: {
    minHeight: 180,
    textAlignVertical: 'top',
  },
  buttonContainer: {
    marginTop: SPACING.sm,
  },
  submitButton: {
    marginBottom: SPACING.md,
  },
});

export default DataImportScreen;
