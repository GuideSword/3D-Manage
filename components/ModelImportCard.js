import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useAppTheme } from '../context/ThemeContext';
import { useServerConfig } from '../context/ServerConfigContext';
import { authorizeModelImport } from '../utils/api';
import Button from './Button';

export const MODEL_IMPORT_RELEASE = Object.freeze({
  version: '1.0.0',
  downloadUrl: 'https://github.com/GuideSword/3D-Manage/releases/download/model-import-v1.0.0/3d-manage-model-handoff-windows-v1.0.0.zip',
  checksumUrl: 'https://github.com/GuideSword/3D-Manage/releases/download/model-import-v1.0.0/SHA256SUMS',
});

export default function ModelImportCard({ user, onStarted }) {
  const { colors } = useAppTheme();
  const { server } = useServerConfig();
  const [busy, setBusy] = useState(false);
  const allowed = ['owner', 'staff'].includes(user?.role);
  if (!allowed) return null;
  const start = async () => {
    setBusy(true);
    try { await authorizeModelImport(); onStarted?.(); } finally { setBusy(false); }
  };
  return (
    <View style={{ margin: 16, marginBottom: 8, padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface }}>
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>批量导入模型</Text>
      <Text style={{ color: colors.textSecondary || colors.text, marginTop: 5 }}>Windows 模型助手 v{MODEL_IMPORT_RELEASE.version} · {server ? '服务器已连接' : '服务器未连接'}</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Button title="下载助手" size="small" variant="outline" onPress={() => Linking.openURL(MODEL_IMPORT_RELEASE.downloadUrl)} />
        <Button title="校验值" size="small" variant="ghost" onPress={() => Linking.openURL(MODEL_IMPORT_RELEASE.checksumUrl)} />
      </View>
      <Button title="批量导入模型" iconLeft="cloud-upload-outline" loading={busy} disabled={!server} onPress={start} style={{ marginTop: 8 }} />
    </View>
  );
}
