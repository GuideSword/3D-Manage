import { Alert, Platform } from 'react-native';

// React Native Web's Alert.alert is empty, including all button callbacks.
// Keep the native button API for these one-action and confirm/cancel dialogs.
export function showAlert(title, message, buttons, options) {
  if (Platform.OS !== 'web') return Alert.alert(title, message, buttons, options);
  const text = [title, message].filter(Boolean).join('\n\n');
  const actions = buttons || [{ text: '确定' }];
  const confirm = actions.find(button => button.style !== 'cancel');
  if (actions.length > 1) {
    return window.confirm(text)
      ? confirm?.onPress?.()
      : actions.find(button => button.style === 'cancel')?.onPress?.();
  }
  window.alert(text);
  return confirm?.onPress?.();
}
