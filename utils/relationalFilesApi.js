import { apiRequest } from './api';
import { getServerRuntime } from './serverRuntime';
import filesCore from './relationalFilesCore.cjs';

export const relationalFilesAPI = filesCore.createRelationalFilesApi({ request: apiRequest, getRuntime: getServerRuntime });
