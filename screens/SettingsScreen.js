import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { COLORS, API_CONFIG } from '../constants';

const SettingsScreen = () => {
  const navigation = useNavigation();

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>设置</Text>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>服务器配置</Text>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>API 地址:</Text>
          <Text style={styles.infoValue}>{API_CONFIG.BASE_URL}</Text>
        </View>
        <Text style={styles.infoHint}>
          如需修改API地址，请编辑 constants/index.js 文件
        </Text>
      </View>

      {/* 可以添加更多设置项，如：用户信息、主题设置、数据导出等 */}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    padding: 20, 
    backgroundColor: COLORS.background 
  },
  title: { 
    fontSize: 24, 
    fontWeight: 'bold', 
    marginBottom: 20, 
    color: COLORS.text 
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  infoCard: {
    padding: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '500',
  },
  infoHint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
});

export default SettingsScreen;
