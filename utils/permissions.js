import { ROLES } from '../constants';

export const canWrite = (userOrRole) => {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return role === ROLES.OWNER || role === ROLES.STAFF;
};

export const canManage = (userOrRole) => {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return role === ROLES.OWNER;
};

export const canExport = canManage;
