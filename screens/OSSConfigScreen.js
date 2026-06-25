import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import storage from '../utils/storage';
import { Button, Card, Input } from '../components';
import { API_CONFIG, COLORS, RADIUS, SPACING, TYPOGRAPHY } from '../constants';
import { useAuth } from '../context/AuthContext';

const OSSConfigScreen = () => {
  const { signOut } = useAuth();
  const [config, setConfig] = useState({
    accessKeyId: '',
    secretAccessKey: '',
    bucket: '',
    region: 'oss-cn-hangzhou',
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const storedConfig = await storage.getItem('ossConfig');
      if (storedConfig) setConfig(JSON.parse(storedConfig));
    } catch (error) {
      console.error('加载 OSS 配置失败:', error);
    }
  };

  const saveConfig = async () => {
    try {
      await storage.setItem('ossConfig', JSON.stringify(config));
      Alert.alert('成功', '配置已保存');
    } catch (error) {
      Alert.alert('错误', '保存配置失败');
    }
  };

  const testConnection = async () => {
    setLoading(true);
    try {
      const token = await storage.getItem('jwtToken');
      const response = await fetch(`${API_CONFIG.BASE_URL}/oss/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(config),
      });
      if (response.ok) {
        const result = await response.json();
        Alert.alert('成功', `OSS 连接正常，Bucket 列表: ${result.buckets.join(', ')}`);
      } else if (response.status === 401) {
        await signOut();
      } else {
        const error = await response.json();
        Alert.alert('失败', error.error || '连接测试失败');
      }
    } catch (error) {
      Alert.alert('错误', `网络请求失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="cloud-upload-outline" size={24} color={COLORS.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>FILE STORAGE</Text>
          <Text style={styles.title}>阿里云 OSS 配置</Text>
          <Text style={styles.subtitle}>配置模型文件和图片上传所需的存储凭证。</Text>
        </View>
      </View>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>访问凭证</Text>
        <Input
          label="Access Key ID"
          value={config.accessKeyId}
          onChangeText={(text) => setConfig({ ...config, accessKeyId: text })}
          placeholder="请输入 Access Key ID"
        />
        <Input
          label="Secret Access Key"
          value={config.secretAccessKey}
          onChangeText={(text) => setConfig({ ...config, secretAccessKey: text })}
          placeholder="请输入 Secret Access Key"
          secureTextEntry
        />
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Bucket 信息</Text>
        <Input
          label="Bucket 名称"
          value={config.bucket}
          onChangeText={(text) => setConfig({ ...config, bucket: text })}
          placeholder="请输入 Bucket 名称"
        />
        <Input
          label="Region 区域"
          value={config.region}
          onChangeText={(text) => setConfig({ ...config, region: text })}
          placeholder="如 oss-cn-hangzhou"
        />
      </Card>

      <View style={styles.buttonContainer}>
        <Button
          title="测试连接"
          iconLeft="pulse-outline"
          onPress={testConnection}
          loading={loading}
          disabled={loading}
          fullWidth
          style={styles.button}
        />
        <Button
          title="保存配置"
          iconLeft="save-outline"
          onPress={saveConfig}
          variant="secondary"
          fullWidth
          style={styles.button}
        />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
  buttonContainer: {
    marginTop: SPACING.sm,
  },
  button: {
    marginBottom: SPACING.md,
  },
});

export default OSSConfigScreen;
