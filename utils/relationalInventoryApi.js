import { apiRequest } from './api';
import { getServerRuntime } from './serverRuntime';
import inventoryCore from './relationalInventoryCore.cjs';

export const relationalInventoryAPI = inventoryCore.createRelationalInventoryApi({ request: apiRequest, getRuntime: getServerRuntime });
