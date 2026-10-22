import { apiRequest } from './api';
import { getServerRuntime } from './serverRuntime';
import csvCore from './relationalCsvCore.cjs';
export const relationalCsvAPI = csvCore.createRelationalCsvApi({ request: apiRequest, getRuntime: getServerRuntime });
