import { Alert, Platform } from 'react-native';

export const confirmDeletion = message => {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message));
  return new Promise(resolve => Alert.alert('确认删除', message, [
    { text: '取消', style: 'cancel', onPress: () => resolve(false) },
    { text: '删除', style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
};
