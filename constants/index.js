import Constants from 'expo-constants';

// 颜色常量
export const COLORS = {
  primary: '#007AFF',
  secondary: '#5AC8FA',
  success: '#34C759',
  warning: '#FF9500',
  danger: '#FF3B30',
  info: '#5AC8FA',
  light: '#F2F2F7',
  dark: '#1C1C1E',
  background: '#FFFFFF',
  surface: '#F2F2F7',
  text: '#1C1C1E',
  textSecondary: '#8E8E93',
  border: '#C6C6C8',
  disabled: '#C6C6C8',
};

// 订单状态
export const ORDER_STATUSES = {
  DRAFT: 'draft',
  PENDING_REVIEW: 'pending_review',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export const ORDER_STATUS_LABELS = {
  [ORDER_STATUSES.DRAFT]: '草稿',
  [ORDER_STATUSES.PENDING_REVIEW]: '待审核',
  [ORDER_STATUSES.IN_PROGRESS]: '执行中',
  [ORDER_STATUSES.COMPLETED]: '已完成',
  [ORDER_STATUSES.CANCELLED]: '已取消',
};

export const ORDER_STATUS_COLORS = {
  [ORDER_STATUSES.DRAFT]: COLORS.textSecondary,
  [ORDER_STATUSES.PENDING_REVIEW]: COLORS.warning,
  [ORDER_STATUSES.IN_PROGRESS]: COLORS.primary,
  [ORDER_STATUSES.COMPLETED]: COLORS.success,
  [ORDER_STATUSES.CANCELLED]: COLORS.danger,
};

// 库存状态
export const STOCK_STATUSES = {
  IN_STOCK: 'in_stock',
  SCRAPPED: 'scrapped',
  FROZEN: 'frozen',
};

export const STOCK_STATUS_LABELS = {
  [STOCK_STATUSES.IN_STOCK]: '在库',
  [STOCK_STATUSES.SCRAPPED]: '报废',
  [STOCK_STATUSES.FROZEN]: '冻结',
};

// 库存操作类型
export const INVENTORY_TXN_TYPES = {
  IN: 'in',
  OUT: 'out',
  ADJUST: 'adjust',
  SCRAP: 'scrap',
};

export const INVENTORY_TXN_LABELS = {
  [INVENTORY_TXN_TYPES.IN]: '入库',
  [INVENTORY_TXN_TYPES.OUT]: '出库',
  [INVENTORY_TXN_TYPES.ADJUST]: '盘点调整',
  [INVENTORY_TXN_TYPES.SCRAP]: '报废',
};

// 权限角色
export const ROLES = {
  OWNER: 'owner',
  STAFF: 'staff',
  VIEWER: 'viewer',
};

export const ROLE_LABELS = {
  [ROLES.OWNER]: '所有者',
  [ROLES.STAFF]: '员工',
  [ROLES.VIEWER]: '查看者',
};

// 材料类型
export const MATERIAL_TYPES = {
  PLA: 'PLA',
  PETG: 'PETG',
  ABS: 'ABS',
  TPU: 'TPU',
  OTHER: '其它材质',
};

// 计量单位
export const UNITS = {
  GRAM: 'g',
  KILOGRAM: 'kg',
  METER: 'm',
  PIECE: '个',
};

// 文件上传限制
export const UPLOAD_LIMITS = {
  MAX_FILE_SIZE: 500 * 1024 * 1024, // 500MB
  CHUNK_SIZE: 5 * 1024 * 1024, // 5MB
  URL_EXPIRY: 10 * 60 * 1000, // 10分钟
};

// API 基础配置
const PUBLIC_API_BASE_URL = 'http://101.37.28.116:3001/api';

const getExpoHost = () => {
  const candidates = [
    Constants.expoConfig?.hostUri,
    Constants.manifest?.debuggerHost,
    Constants.manifest?.hostUri,
    Constants.manifest2?.extra?.expoClient?.hostUri,
    Constants.linkingUri,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    const hostWithPort = String(candidate)
      .replace(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//, '')
      .split('/')[0];
    const host = hostWithPort.split(':')[0];

    if (host) {
      return host;
    }
  }

  return null;
};

const getDefaultApiBaseUrl = () => {
  const envApiBaseUrl =
    typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_API_BASE_URL : undefined;
  if (envApiBaseUrl) {
    return envApiBaseUrl;
  }

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    const expoHost = getExpoHost();
    if (expoHost) {
      return `http://${expoHost}:3001/api`;
    }
  }

  return PUBLIC_API_BASE_URL;
};

const DEFAULT_API_BASE_URL = getDefaultApiBaseUrl();

export const API_CONFIG = {
  BASE_URL: DEFAULT_API_BASE_URL,
  TIMEOUT: 30000,
};

// 导航路由名称
export const ROUTES = {
  HOME: 'Home',
  ORDERS: 'Orders',
  MODELS: 'Models',
  MATERIALS: 'Materials',
  ORDER_DETAIL: 'OrderDetail',
  CREATE_ORDER: 'CreateOrder',
  MATERIAL_DETAIL: 'MaterialDetail',
  CREATE_MATERIAL: 'CreateMaterial',
  CREATE_MODEL: 'CreateModel',
  MODEL_DETAIL: 'ModelDetail',
  INBOUND_TRANSACTION: 'InboundTransaction',
  OUTBOUND_TRANSACTION: 'OutboundTransaction',
  ADJUST_TRANSACTION: 'AdjustTransaction',
  OSS_CONFIG: 'OSSConfig',
  DATA_IMPORT: 'DataImport',
};

// 屏幕标题
export const SCREEN_TITLES = {
  [ROUTES.HOME]: '首页',
  [ROUTES.ORDERS]: '订单管理',
  [ROUTES.MODELS]: '模型管理',
  [ROUTES.MATERIALS]: '耗材管理',
  [ROUTES.ORDER_DETAIL]: '订单详情',
  [ROUTES.MODEL_DETAIL]: '模型详情',
  [ROUTES.MATERIAL_DETAIL]: '耗材详情',
  [ROUTES.INBOUND_TRANSACTION]: '入库操作',
  [ROUTES.OUTBOUND_TRANSACTION]: '出库操作',
  [ROUTES.ADJUST_TRANSACTION]: '库存盘点',
  [ROUTES.OSS_CONFIG]: 'OSS 配置',
  [ROUTES.DATA_IMPORT]: '数据导入',
};
