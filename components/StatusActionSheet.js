import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  COLORS,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  RADIUS,
  SHADOWS,
  SPACING,
  TYPOGRAPHY,
} from '../constants';
import {
  getDowngradeMessage,
  getDowngradeTitle,
  getRestoreTarget,
  isAllowedTransition,
  isDowngrade,
  isReopen,
} from '../utils/orderStatus';

const STATUS_ORDER = [
  ORDER_STATUSES.DRAFT,
  ORDER_STATUSES.PENDING_REVIEW,
  ORDER_STATUSES.IN_PROGRESS,
  ORDER_STATUSES.COMPLETED,
  ORDER_STATUSES.CANCELLED,
];

const hexToRgba = (hex, alpha) => {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) {
    return `rgba(15, 23, 42, ${alpha})`;
  }
  const normalized = hex.length === 3
    ? hex.split('').map((c) => c + c).join('')
    : hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(15, 23, 42, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const Ripple = ({ x, y, color }) => {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 540,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress]);

  const size = 260;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0.28, 0],
        }),
        transform: [
          {
            scale: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0.35, 2.6],
            }),
          },
        ],
      }}
    />
  );
};

const StatusOption = ({ status, isCurrent, isDowngradeOption, isReopenOption, isAllowed, onPress }) => {
  const color = ORDER_STATUS_COLORS[status] || COLORS.textSecondary;
  const label = ORDER_STATUS_LABELS[status] || '未知';
  const [ripple, setRipple] = useState(null);
  const [optionSize, setOptionSize] = useState({ width: 0, height: 0 });
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = (event) => {
    if (isCurrent || !isAllowed) {
      return;
    }
    const nativeEvent = event?.nativeEvent || {};
    const fallbackX = optionSize.width / 2;
    const fallbackY = optionSize.height / 2;
    const x = Number.isFinite(nativeEvent.locationX) ? nativeEvent.locationX : fallbackX;
    const y = Number.isFinite(nativeEvent.locationY) ? nativeEvent.locationY : fallbackY;
    setRipple({ id: Date.now(), x, y });
    Animated.timing(scaleAnim, {
      toValue: 0.985,
      duration: 90,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    if (isCurrent || !isAllowed) {
      return;
    }
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  const removeRipple = (id) => {
    setRipple((current) => (current && current.id === id ? null : current));
  };

  const downgradeTone = isReopenOption
    ? { icon: 'refresh-outline', text: '重开', color: COLORS.danger, soft: COLORS.dangerSoft }
    : { icon: 'arrow-down-circle-outline', text: '退级', color: COLORS.warning, soft: COLORS.warningSoft };

  const isDisabled = isCurrent || !isAllowed;

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={isDisabled}
      android_disableSound
      style={({ pressed }) => [
        styles.optionPressable,
        pressed && !isDisabled && { backgroundColor: hexToRgba(color, 0.05) },
      ]}
    >
      <Animated.View
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout || {};
          if (width && height) {
            setOptionSize({ width, height });
          }
        }}
        style={[
          styles.option,
          isCurrent && {
            backgroundColor: hexToRgba(color, 0.08),
            borderColor: hexToRgba(color, 0.22),
          },
          isDowngradeOption && !isCurrent && isAllowed && {
            borderColor: hexToRgba(downgradeTone.color, 0.35),
          },
          !isAllowed && !isCurrent && styles.optionLocked,
          { transform: [{ scale: scaleAnim }] },
        ]}
      >
        {ripple && isAllowed ? (
          <Ripple
            key={ripple.id}
            x={ripple.x}
            y={ripple.y}
            color={isDowngradeOption ? downgradeTone.color : color}
          />
        ) : null}
        <View
          style={[
            styles.optionDot,
            { backgroundColor: color },
            !isAllowed && !isCurrent && styles.optionDotLocked,
          ]}
        />
        <Text
          style={[
            styles.optionLabel,
            isCurrent && { color },
            !isAllowed && !isCurrent && styles.optionLabelLocked,
          ]}
        >
          {label}
        </Text>
        {isCurrent ? (
          <View style={styles.currentBadge}>
            <Ionicons name="checkmark-circle" size={18} color={color} />
            <Text style={[styles.currentBadgeText, { color }]}>当前</Text>
          </View>
        ) : !isAllowed ? (
          <View style={styles.lockedBadge}>
            <Ionicons name="lock-closed-outline" size={13} color={COLORS.textTertiary} />
            <Text style={styles.lockedBadgeText}>不可用</Text>
          </View>
        ) : isDowngradeOption ? (
          <View
            style={[
              styles.downgradeTag,
              { backgroundColor: hexToRgba(downgradeTone.color, 0.1), borderColor: hexToRgba(downgradeTone.color, 0.3) },
            ]}
          >
            <Ionicons name={downgradeTone.icon} size={14} color={downgradeTone.color} />
            <Text style={[styles.downgradeTagText, { color: downgradeTone.color }]}>
              {downgradeTone.text}
            </Text>
          </View>
        ) : (
          <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
        )}
      </Animated.View>
    </Pressable>
  );
};

const RestoreBody = ({ order, busy, onConfirm, onClose }) => {
  const target = getRestoreTarget(order.status);
  const targetLabel = target ? ORDER_STATUS_LABELS[target] : '草稿';
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const [ripple, setRipple] = useState(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const handlePressIn = (event) => {
    if (busy) return;
    const nativeEvent = event?.nativeEvent || {};
    const fallbackX = size.width / 2;
    const fallbackY = size.height / 2;
    const x = Number.isFinite(nativeEvent.locationX) ? nativeEvent.locationX : fallbackX;
    const y = Number.isFinite(nativeEvent.locationY) ? nativeEvent.locationY : fallbackY;
    setRipple({ id: Date.now(), x, y });
    Animated.timing(scaleAnim, {
      toValue: 0.985,
      duration: 90,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };
  const handlePressOut = () => {
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  return (
    <View>
      <View style={styles.warningCard}>
        <Ionicons name="alert-circle-outline" size={20} color={COLORS.warning} />
        <View style={styles.warningTextGroup}>
          <Text style={styles.warningTitle}>该订单已取消</Text>
          <Text style={styles.warningBody}>
            恢复后会回到"{targetLabel}"状态，之后需要重新走完整流程。
          </Text>
        </View>
      </View>
      <Pressable
        onPress={onConfirm}
        disabled={busy}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        android_disableSound
        style={({ pressed }) => [
          styles.restoreButton,
          pressed && { opacity: 0.9 },
        ]}
      >
        <Animated.View
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout || {};
            if (width && height) setSize({ width, height });
          }}
          style={[styles.restoreButtonInner, { transform: [{ scale: scaleAnim }] }]}
        >
          {ripple ? (
            <Ripple
              key={ripple.id}
              x={ripple.x}
              y={ripple.y}
              color={COLORS.primary}
            />
          ) : null}
          <Ionicons name="refresh-outline" size={20} color={COLORS.surfaceElevated} />
          <Text style={styles.restoreButtonText}>
            恢复为{targetLabel}
          </Text>
          {busy ? (
            <ActivityIndicator size="small" color={COLORS.surfaceElevated} />
          ) : null}
        </Animated.View>
      </Pressable>
    </View>
  );
};

const StatusActionSheet = ({
  visible,
  order,
  busy = false,
  mode = 'status',
  onSelect,
  onConfirmRestore,
  onClose,
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(56)).current;
  const scaleAnim = useRef(new Animated.Value(0.98)).current;

  useEffect(() => {
    if (visible) {
      fadeAnim.setValue(0);
      slideAnim.setValue(56);
      scaleAnim.setValue(0.98);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, fadeAnim, slideAnim, scaleAnim]);

  if (!order) {
    return null;
  }

  const customerName = order.customer?.name || order.customerName || '未知客户';
  const currentStatus = order.status;
  const currentColor = ORDER_STATUS_COLORS[currentStatus] || COLORS.textSecondary;
  const currentLabel = ORDER_STATUS_LABELS[currentStatus] || '未知';
  const isRestoreMode = mode === 'restore';

  const handleOptionPress = (status) => {
    if (!order || status === currentStatus) {
      return;
    }
    if (isDowngrade(currentStatus, status)) {
      const reopen = isReopen(currentStatus, status);
      Alert.alert(
        getDowngradeTitle(currentStatus, status),
        getDowngradeMessage(currentStatus, status),
        [
          { text: '取消', style: 'cancel' },
          {
            text: reopen ? '重新打开' : '确认退级',
            style: 'destructive',
            onPress: () => onSelect?.(status),
          },
        ],
        { cancelable: true }
      );
      return;
    }
    onSelect?.(status);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={busy ? undefined : onClose}
    >
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={busy ? undefined : onClose}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
            },
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>
              {isRestoreMode ? '恢复订单' : '修改订单状态'}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {customerName} · 订单 #{order.id}
            </Text>
            <View style={styles.currentRow}>
              <Text style={styles.currentLabel}>当前状态</Text>
              <View
                style={[
                  styles.currentPill,
                  {
                    backgroundColor: hexToRgba(currentColor, 0.1),
                    borderColor: hexToRgba(currentColor, 0.22),
                  },
                ]}
              >
                <View style={[styles.currentDot, { backgroundColor: currentColor }]} />
                <Text style={[styles.currentText, { color: currentColor }]}>
                  {currentLabel}
                </Text>
              </View>
            </View>
          </View>
          {isRestoreMode ? (
            <RestoreBody
              order={order}
              busy={busy}
              onConfirm={() => {
                const target = getRestoreTarget(order.status);
                if (target) onConfirmRestore?.(target);
              }}
              onClose={onClose}
            />
          ) : (
            <View style={styles.list}>
              {STATUS_ORDER.map((status) => (
                <StatusOption
                  key={status}
                  status={status}
                  isCurrent={status === currentStatus}
                  isAllowed={isAllowedTransition(currentStatus, status)}
                  isDowngradeOption={isDowngrade(currentStatus, status)}
                  isReopenOption={isReopen(currentStatus, status)}
                  onPress={() => handleOptionPress(status)}
                />
              ))}
            </View>
          )}
          <Pressable
            onPress={onClose}
            disabled={busy}
            style={({ pressed }) => [
              styles.cancelButton,
              pressed && { backgroundColor: COLORS.surface },
            ]}
          >
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  sheet: {
    backgroundColor: COLORS.surfaceElevated,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xxl,
    paddingHorizontal: SPACING.lg,
    ...SHADOWS.floating,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.borderStrong,
    marginBottom: SPACING.md,
  },
  header: {
    paddingBottom: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  title: {
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.text,
  },
  subtitle: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  currentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.md,
    gap: SPACING.sm,
  },
  currentLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textTertiary,
  },
  currentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    gap: 6,
  },
  currentDot: {
    width: 8,
    height: 8,
    borderRadius: RADIUS.pill,
  },
  currentText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '700',
  },
  list: {
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
    gap: SPACING.xs,
  },
  optionPressable: {
    borderRadius: RADIUS.lg,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: 'transparent',
    overflow: 'hidden',
    gap: SPACING.md,
  },
  optionDot: {
    width: 10,
    height: 10,
    borderRadius: RADIUS.pill,
  },
  optionLabel: {
    flex: 1,
    ...TYPOGRAPHY.body,
    color: COLORS.text,
    fontWeight: '600',
  },
  currentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  currentBadgeText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '700',
  },
  downgradeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    gap: 4,
  },
  downgradeTagText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '700',
  },
  optionLocked: {
    opacity: 0.55,
  },
  optionDotLocked: {
    opacity: 0.4,
  },
  optionLabelLocked: {
    color: COLORS.textTertiary,
  },
  lockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  lockedBadgeText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textTertiary,
    fontWeight: '700',
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.warningSoft,
    borderWidth: 1,
    borderColor: hexToRgba(COLORS.warning, 0.35),
  },
  warningTextGroup: {
    flex: 1,
    gap: 4,
  },
  warningTitle: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
    fontWeight: '700',
  },
  warningBody: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  restoreButton: {
    marginTop: SPACING.lg,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    backgroundColor: COLORS.primary,
  },
  restoreButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    minHeight: 50,
  },
  restoreButtonText: {
    ...TYPOGRAPHY.body,
    color: COLORS.surfaceElevated,
    fontWeight: '700',
  },
  cancelButton: {
    height: 48,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cancelText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
});

export default StatusActionSheet;
