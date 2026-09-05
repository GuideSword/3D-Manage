import React, { useState } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  Image,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

// Image attachment row used inside AgentChatScreen's input bar.
//
// Uses expo-document-picker (already installed) rather than
// expo-image-picker, to keep zero new dependencies. The picked file
// is base64-encoded locally and exposed to the parent as a data URL,
// matching the Agent MVP plan (M3 multimodal supports data: URIs).
//
// Props:
//   onAttach: (image | null, images) => void
//     Called whenever the local image list changes. The first arg is
//     the new image on add, or null on remove. The second arg is the
//     full updated list. The parent decides what to send with the
//     current message.

export default function ImageAttachment({ onAttach }) {
  const [images, setImages] = useState([]);

  const pick = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['image/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets || res.assets.length === 0) return;

      const file = res.assets[0];

      // Guard against huge files — base64-encoding a 20MB image in
      // memory on a phone will OOM. The backend's /agent/chat
      // expects a reasonable payload; cap at ~4MB of source.
      if (file.size && file.size > 4 * 1024 * 1024) {
        Alert.alert('图片过大', '请选择小于 4MB 的图片');
        return;
      }

      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const mime = file.mimeType || guessMime(file.name) || 'image/png';
      const dataUrl = `data:${mime};base64,${base64}`;

      const newImg = {
        uri: file.uri,
        dataUrl,
        name: file.name || 'image',
        mimeType: mime,
        size: file.size || 0,
      };

      setImages((prev) => {
        const next = [...prev, newImg];
        onAttach?.(newImg, next);
        return next;
      });
    } catch (err) {
      Alert.alert('选择图片失败', err?.message || String(err));
    }
  };

  const remove = (idx) => {
    setImages((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      onAttach?.(null, next);
      return next;
    });
  };

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        <TouchableOpacity style={styles.addBtn} onPress={pick} activeOpacity={0.7}>
          <Text style={styles.addText}>📎</Text>
        </TouchableOpacity>
        {images.map((img, idx) => (
          <TouchableOpacity
            key={`${img.uri}-${idx}`}
            onLongPress={() =>
              Alert.alert('移除图片', `删除 ${img.name}?`, [
                { text: '取消', style: 'cancel' },
                { text: '删除', style: 'destructive', onPress: () => remove(idx) },
              ])
            }
            activeOpacity={0.8}
            style={styles.thumbWrap}
          >
            <Image source={{ uri: img.uri }} style={styles.thumb} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function guessMime(name) {
  if (!name) return null;
  const ext = String(name).split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'heic': return 'image/heic';
    default: return null;
  }
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#FAFAFC',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5EA',
  },
  row: {
    alignItems: 'center',
    gap: 6,
    paddingRight: 8,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: { fontSize: 18, lineHeight: 22 },
  thumbWrap: {
    width: 36,
    height: 36,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#ddd',
  },
  thumb: { width: '100%', height: '100%' },
});
