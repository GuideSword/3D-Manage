import { apiRequest } from './api';
import { getServerRuntime } from './serverRuntime';
import masterDataCore from './masterDataCore.cjs';

const call = masterDataCore.createRelationalRequest({ request: apiRequest, getRuntime: getServerRuntime });
const idPath = id => {
  if (typeof id !== 'string' || !id.trim() || id.length > 500) throw Object.assign(new Error('订单标识无效'), { status: 400, code: 'ORDER_FORM_INVALID' });
  return `/orders/${encodeURIComponent(id)}`;
};
export const relationalOrdersAPI = Object.freeze({
  getById: id => call(idPath(id)),
  create: (body, key) => call('/orders', 'POST', body, key),
  update: (id, { version, changes }, key) => call(idPath(id), 'PATCH', { version: masterDataCore.recordVersion(version), changes }, key),
  refreshCustomer: (id, version, key) => call(`${idPath(id)}/refresh-customer`, 'POST', { version: masterDataCore.recordVersion(version) }, key),
});
