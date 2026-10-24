import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useAppTheme } from '../context/ThemeContext';

export const MODEL_HANDOFF_RELEASE = Object.freeze({
  version: '1.0.0',
  downloadUrl: 'https://github.com/GuideSword/3D-Manage/releases/download/model-handoff-v1.0.0/3d-manage-model-handoff-windows-v1.0.0.zip',
  checksumUrl: 'https://github.com/GuideSword/3D-Manage/releases/download/model-handoff-v1.0.0/SHA256SUMS',
});

export default function ModelHandoffInstallCard({ onOpen, ready = false, busy = false }) {
  const { colors } = useAppTheme();
  const button = (label, action, disabled = false) => <Pressable accessibilityRole="button" disabled={disabled} onPress={action} style={{ backgroundColor: colors.primary, borderRadius: 8, padding: 10, marginTop: 8, opacity: disabled ? 0.5 : 1 }}><Text style={{ color: '#fff', fontWeight: '600' }}>{label}</Text></Pressable>;
  return <View style={{ marginTop: 12, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10 }}>
    <Text style={{ color: colors.text, fontWeight: '700' }}>本地模型助手 v{MODEL_HANDOFF_RELEASE.version}</Text>
    <Text style={{ color: colors.text, marginTop: 6 }}>首次使用请下载并安装助手。安装完成后返回这里，再点击打开本地助手。安装过程会由 Windows 单独请求确认。</Text>
    {button('下载 Windows 助手', () => Linking.openURL(MODEL_HANDOFF_RELEASE.downloadUrl))}
    {button('查看 SHA-256 校验值', () => Linking.openURL(MODEL_HANDOFF_RELEASE.checksumUrl))}
    {button(ready ? '打开本地助手' : '完成授权后打开本地助手', onOpen, !ready || busy)}
  </View>;
}
