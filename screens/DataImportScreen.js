import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { COLORS } from '../constants';
import { Card, Button, Input, Picker } from '../components';
import { ordersAPI, modelsAPI, materialsAPI, stockAPI, isAuthRequiredError } from '../utils/api';
import { validateExtension } from '../utils/upload';

const IMPORT_OPTIONS = [
  { value: 'orders', label: '订单' },
  { value: 'models', label: '模型' },
  { value: 'materials', label: '物料' },
  { value: 'stockLots', label: '库存批次' },
];

const EXAMPLE_HEADERS = {
  orders: 'customer_name,status,total,currency,due_date,item_model_name,item_material_type,item_color,item_quantity,item_unit_price,notes',
  models: 'name,dimensions,estimated_material_grams,visibility,notes',
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
      <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
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
          <Text style={styles.headerText}>{currentHeader}</Text>
          {selectedFileName ? (
            <View style={styles.fileInfo}>
              <Text style={styles.fileName}>{selectedFileName}</Text>
            </View>
          ) : null}
          <Button
            title="选择 CSV 文件"
            onPress={pickCsvFile}
            variant="outline"
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
            onPress={handleImport}
            loading={loading}
            disabled={loading}
            style={styles.submitButton}
          />
          <Button
            title="取消"
            onPress={() => navigation.goBack()}
            variant="outline"
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
  section: {
    margin: 16,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  headerText: {
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  fileInfo: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    marginBottom: 12,
  },
  fileName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  fileButton: {
    marginBottom: 12,
  },
  csvInput: {
    minHeight: 180,
    textAlignVertical: 'top',
  },
  buttonContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  submitButton: {
    marginBottom: 12,
  },
});

export default DataImportScreen;
