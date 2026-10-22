import { Alert, Platform } from 'react-native';

export const confirmAction = (title, message, confirmLabel = '确定') => {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message));
  return new Promise(resolve => Alert.alert(title, message, [
    { text: '取消', style: 'cancel', onPress: () => resolve(false) },
    { text: confirmLabel, onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
};
export const confirmDeletion = message => confirmAction('确认删除', message, '删除');
