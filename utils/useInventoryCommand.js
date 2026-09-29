import { useRef } from 'react';
import * as Crypto from 'expo-crypto';
import { useAuth } from '../context/AuthContext';
import { getServerRuntime } from './serverRuntime';
import inventoryCommandCore from './inventoryCommandCore.cjs';

export const { isValidGramQuantity } = inventoryCommandCore;

export const useInventoryCommand = ({ reusable = false } = {}) => {
  const { user } = useAuth();
  const controller = useRef(null);
  if (!controller.current) controller.current = inventoryCommandCore.createInventoryCommandController(() => Crypto.randomUUID());
  return async (operation, payload, send) => {
    const { serverKey, sessionEpoch } = getServerRuntime();
    const result = await controller.current.run(operation, payload, { serverKey, sessionEpoch, userId: user?.id }, send);
    if (reusable && result !== null) controller.current = inventoryCommandCore.createInventoryCommandController(() => Crypto.randomUUID());
    return result;
  };
};
