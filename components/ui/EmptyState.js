import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { useAppTheme } from '../../context/ThemeContext';
import Button from '../Button';
import XiaoliBrandMark from '../cyber/XiaoliBrandMark';

const EmptyState = ({
  icon = 'paw-outline',
  title,
  description,
  actionLabel,
  onAction,
  style,
}) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={[styles.container, style]}>
      <XiaoliBrandMark size={76} style={styles.mascot} />
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={34} color={colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} size="small" onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
};

const createStyles = (colors) => StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: 36,
  },
  iconWrap: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: colors.primarySoft,
    marginBottom: SPACING.md,
  },
  mascot: {
    marginBottom: -10,
  },
  title: {
    ...TYPOGRAPHY.sectionTitle,
    color: colors.text,
    textAlign: 'center',
  },
  description: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.xs,
    maxWidth: 300,
  },
  action: {
    marginTop: SPACING.lg,
  },
});

export default EmptyState;
