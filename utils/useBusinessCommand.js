import { useRef } from 'react';
import * as Crypto from 'expo-crypto';
import { useAuth } from '../context/AuthContext';
import { getServerRuntime } from './serverRuntime';
import masterDataCore from './masterDataCore.cjs';

export const useBusinessCommand = ({ reusable = false } = {}) => {
  const { user } = useAuth();
  const controller = useRef(null);
  if (!controller.current) controller.current = masterDataCore.createBusinessCommandController(() => Crypto.randomUUID(), { reusable });
  return (operation, payload, send) => {
    const { serverKey, sessionEpoch } = getServerRuntime();
    return controller.current.run(operation, payload, { serverKey, sessionEpoch, userId: user?.id }, send);
  };
};
