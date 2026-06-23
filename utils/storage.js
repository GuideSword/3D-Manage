import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const memoryStorage = new Map();

const getLocalStorage = () => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch (error) {
    return null;
  }
};

const storage = {
  async getItem(key) {
    if (Platform.OS === 'web') {
      const localStorage = getLocalStorage();
      return localStorage ? localStorage.getItem(key) : memoryStorage.get(key) || null;
    }

    return SecureStore.getItemAsync(key);
  },

  async setItem(key, value) {
    const stringValue = String(value);

    if (Platform.OS === 'web') {
      const localStorage = getLocalStorage();
      if (localStorage) {
        localStorage.setItem(key, stringValue);
      } else {
        memoryStorage.set(key, stringValue);
      }
      return;
    }

    return SecureStore.setItemAsync(key, stringValue);
  },

  async deleteItem(key) {
    if (Platform.OS === 'web') {
      const localStorage = getLocalStorage();
      if (localStorage) {
        localStorage.removeItem(key);
      }
      memoryStorage.delete(key);
      return;
    }

    return SecureStore.deleteItemAsync(key);
  },
};

export default storage;
