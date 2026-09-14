import { File } from 'expo-file-system';
import imageCore from './agentImageCore.cjs';

export const {
  IMAGE_LIMITS,
  normalizePickedAssets,
  appendImages,
  removeImage,
  canSendDraft,
  imageOnlyBubbleText,
} = imageCore;

export const prepareAgentImages = (images) => imageCore.prepareImagesForSend(
  images,
  async (uri) => {
    try {
      const file = new File(uri);
      if (!file.exists) {
        const error = new Error('选择的图片已不存在，请重新选择');
        error.code = 'IMAGE_READ_FAILED';
        throw error;
      }
      return await file.base64();
    } catch (cause) {
      if (cause?.code === 'IMAGE_READ_FAILED') throw cause;
      const error = new Error('读取图片失败');
      error.code = 'IMAGE_READ_FAILED';
      error.cause = cause;
      throw error;
    }
  }
);
