import { apiRequest } from './api';
import { getServerRuntime } from './serverRuntime';
import masterDataCore from './masterDataCore.cjs';

const call = masterDataCore.createRelationalRequest({ request: apiRequest, getRuntime: getServerRuntime });
export const relationalSystemAPI = {
  dashboard: () => call('/system/dashboard'),
  organization: () => call('/system/organization'),
  updateOrganization: (payload, key) => call('/system/organization', 'PATCH', {
    version: masterDataCore.recordVersion(payload.version), organizationName: payload.organizationName,
  }, key),
};
