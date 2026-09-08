import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card } from '../components';
import { RADIUS, SPACING, TYPOGRAPHY } from '../constants';
import { useServerConfig } from '../context/ServerConfigContext';
import { useAppTheme } from '../context/ThemeContext';

const ServerConnectionErrorScreen = ({ navigation }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { server, connectionError, refreshServer } = useServerConfig();
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try { await refreshServer(); } catch (_) { /* context retains the visible error */ }
    finally { setRetrying(false); }
  };

  return (
    <View style={styles.container}>
      <Card style={styles.card} padding="large">
        <View style={styles.icon}><Ionicons name="cloud-offline-outline" size={28} color={colors.danger} /></View>
        <Text style={styles.title}>无法连接已保存的服务器</Text>
        <Text style={styles.message}>{connectionError?.message || '请检查服务器状态和网络连接。'}</Text>
        <Text style={styles.label}>{server?.organizationName || '3D Manage 服务器'}</Text>
        <Text style={styles.endpoint}>{server?.apiBaseUrl}</Text>
        <Button title="重试连接" onPress={retry} loading={retrying} disabled={retrying} fullWidth style={styles.primary} />
        <Button title="更换服务器" variant="secondary" onPress={() => navigation.navigate('ServerSetup', { replacement: true })} fullWidth />
      </Card>
    </View>
  );
};

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: SPACING.xl, backgroundColor: colors.background },
  card: { width: '100%', maxWidth: 520, alignSelf: 'center', marginHorizontal: 0 },
  icon: { width: 52, height: 52, borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerSoft, marginBottom: SPACING.lg },
  title: { ...TYPOGRAPHY.sectionTitle, color: colors.text },
  message: { ...TYPOGRAPHY.body, color: colors.danger, marginTop: SPACING.sm },
  label: { ...TYPOGRAPHY.meta, color: colors.text, marginTop: SPACING.xl },
  endpoint: { ...TYPOGRAPHY.caption, color: colors.textSecondary, marginTop: SPACING.xs },
  primary: { marginTop: SPACING.xl, marginBottom: SPACING.sm },
});

export default ServerConnectionErrorScreen;
