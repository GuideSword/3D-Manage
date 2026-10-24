import { apiRequest } from './api';
import { getServerRuntime } from './serverRuntime';
import masterDataCore from './masterDataCore.cjs';

const masterDataApi = masterDataCore.createMasterDataApi({ request: apiRequest, getRuntime: getServerRuntime });
export const customersAPI = masterDataApi.partners('customers');
export const suppliersAPI = masterDataApi.partners('suppliers');
export const warehousesAPI = masterDataApi.warehouses;
export const partnerAPI = kind => kind === 'customers' ? customersAPI : kind === 'suppliers' ? suppliersAPI : masterDataApi.partners(kind);
