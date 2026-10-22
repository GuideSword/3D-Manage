import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../context/ThemeContext';
import { SPACING } from '../constants';

export const useMasterDataStyles = () => {
  const { colors } = useAppTheme();
  return useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: SPACING.lg, paddingBottom: 48, gap: SPACING.md, width: '100%', maxWidth: 840, alignSelf: 'center' },
    title: { color: colors.text, fontSize: 22, fontWeight: '700' },
    name: { color: colors.text, fontSize: 17, fontWeight: '600', lineHeight: 25 },
    text: { color: colors.textSecondary, fontSize: 14, lineHeight: 23 },
    error: { color: colors.danger, fontSize: 14, lineHeight: 23 },
    row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
    grow: { flex: 1 },
    field: { paddingVertical: SPACING.sm },
  }), [colors]);
};
export default function MasterDataPage({ title, children }) {
  const styles = useMasterDataStyles();
  return <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.container}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{title}</Text>
      {children}
    </ScrollView>
  </SafeAreaView>;
}
