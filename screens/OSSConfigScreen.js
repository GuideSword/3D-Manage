import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Input, Button } from '../components';
import { COLORS, API_CONFIG } from '../constants';

const OSSConfigScreen = () => {
  const [config, setConfig] = useState({ accessKeyId: '', secretAccessKey: '', bucket: '', region: 'oss-cn-hangzhou' });
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadConfig(); }, []);

  const loadConfig = async () => {
    try {
      const storedConfig = await SecureStore.getItemAsync('ossConfig');
      if (storedConfig) setConfig(JSON.parse(storedConfig));
    } catch (error) { console.error('加载 OSS 配置失败:', error); }
  };

  const saveConfig = async () => {
    try {
      await SecureStore.setItemAsync('ossConfig', JSON.stringify(config));
      Alert.alert('成功', '配置已保存');
    } catch (error) { Alert.alert('错误', '保存配置失败'); }
  };

  const testConnection = async () => {
    setLoading(true);
    try {
      const token = await SecureStore.getItemAsync('jwtToken');
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/oss/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(config),
      });
      if (response.ok) {
        const result = await response.json();
        Alert.alert('成功', `OSS 连接正常！Bucket 列表: ${result.buckets.join(', ')}`);
      } else {
        const error = await response.json();
        Alert.alert('失败', error.error || '连接测试失败');
      }
    } catch (error) { Alert.alert('错误', `网络请求失败: ${error.message}`); } finally { setLoading(false); }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>阿里云 OSS 配置</Text>
      <Input label="Access Key ID" value={config.accessKeyId} onChangeText={(text) => setConfig({ ...config, accessKeyId: text })} placeholder="请输入 Access Key ID" />
      <Input label="Secret Access Key" value={config.secretAccessKey} onChangeText={(text) => setConfig({ ...config, secretAccessKey: text })} placeholder="请输入 Secret Access Key" secureTextEntry />
      <Input label="Bucket 名称" value={config.bucket} onChangeText={(text) => setConfig({ ...config, bucket: text })} placeholder="请输入 Bucket 名称" />
      <Input label="Region (区域)" value={config.region} onChangeText={(text) => setConfig({ ...config, region: text })} placeholder="如 oss-cn-hangzhou" />
      <Button title="测试连接" onPress={testConnection} loading={loading} style={styles.button} />
      <Button title="保存配置" onPress={saveConfig} variant="secondary" style={styles.button} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: COLORS.background },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, color: COLORS.text },
  button: { marginTop: 10 },
});

export default OSSConfigScreen;
