import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { useAppTheme } from '../../context/ThemeContext';

const ScreenHeader = ({ eyebrow, title, subtitle, actions, style }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={[styles.container, style]}>
      <View style={styles.copy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
};

const createStyles = (colors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    ...TYPOGRAPHY.caption,
    color: colors.primaryDark,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginBottom: 3,
  },
  title: {
    ...TYPOGRAPHY.screenTitle,
    color: colors.text,
  },
  subtitle: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
    marginTop: SPACING.xs,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
});

export default ScreenHeader;
