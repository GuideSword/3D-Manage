import { apiRequest } from './api';
import { getServerRuntime } from './serverRuntime';
import usersCore from './relationalUsersCore.cjs';
export const relationalUsersAPI = usersCore.createRelationalUsersApi({ request: apiRequest, getRuntime: getServerRuntime });
