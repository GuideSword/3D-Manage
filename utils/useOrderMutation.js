import { ordersAPI } from './api';
import { relationalOrdersAPI } from './relationalOrdersApi';
import { useServerConfig } from '../context/ServerConfigContext';
import { useMasterDataMutation } from './useMasterDataMutation';
import masterDataCore from './masterDataCore.cjs';

export function useOrderMutation(navigation) {
  const { server } = useServerConfig();
  const relational = masterDataCore.supportsMasterData(server);
  const mutation = useMasterDataMutation(navigation);
  return {
    ...mutation,
    locked: Boolean(mutation.pending) || mutation.loading || mutation.conflict,
    transition: (order, status) => mutation.run('order.transition',
      { id: order.id, ...(relational ? { version: order.version } : {}), status },
      (body, key) => relational
        ? relationalOrdersAPI.updateStatus(body.id, body, key)
        : ordersAPI.updateStatus(body.id, body.status)),
    remove: order => mutation.run('order.delete',
      { id: order.id, ...(relational ? { version: order.version } : {}) },
      (body, key) => relational
        ? relationalOrdersAPI.delete(body.id, body.version, key)
        : ordersAPI.delete(body.id)),
  };
}
