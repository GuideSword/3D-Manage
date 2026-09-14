import React, { useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  ScrollView,
  Text,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { trackPickedAsset } from '../../utils/sessionStorage';
import { normalizePickedAssets } from '../../utils/agentImage';
import { useAppTheme } from '../../context/ThemeContext';

const ERROR_MESSAGES = {
  IMAGE_LIMIT_EXCEEDED: '每条消息最多发送 4 张图片',
  IMAGE_TOO_LARGE: '单张图片不能超过 4 MB',
  IMAGE_TOTAL_TOO_LARGE: '图片总大小不能超过 6 MB',
  IMAGE_TYPE_UNSUPPORTED: '仅支持 JPEG、PNG 和 WebP 图片',
};

export default function ImageAttachment({ images = [], onAdd, onRemove, disabled = false }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const pick = async () => {
    if (disabled) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'image/webp'],
        copyToCacheDirectory: true,
        multiple: true,
      });
      const picked = normalizePickedAssets(result);
      if (!picked.length) return;
      await Promise.all(picked.map((asset) => trackPickedAsset(asset)));
      onAdd?.(picked);
    } catch (error) {
      Alert.alert('选择图片失败', ERROR_MESSAGES[error?.code] || '选择图片失败，请稍后重试');
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        <TouchableOpacity
          style={[styles.addBtn, disabled && styles.disabled]}
          onPress={pick}
          disabled={disabled}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={images.length ? '继续添加图片' : '添加图片'}
        >
          <Ionicons name="image-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
        {images.map((image) => (
          <View key={image.id} style={styles.thumbWrap}>
            <Image source={{ uri: image.uri }} style={styles.thumb} />
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={() => onRemove?.(image.id)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`删除图片 ${image.name}`}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="close" size={13} color="#fff" />
            </TouchableOpacity>
          </View>
        ))}
        {images.length > 0 ? (
          <Text style={styles.countText}>已选择 {images.length} 张</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.surfaceElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  row: {
    minHeight: 44,
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
  thumbWrap: {
    width: 52,
    height: 52,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  thumb: { width: '100%', height: '100%' },
  removeBtn: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20, 16, 38, 0.82)',
  },
  countText: { fontSize: 12, color: colors.textSecondary },
});
