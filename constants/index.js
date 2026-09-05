import Constants from 'expo-constants';

export const COLORS = {
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  primarySoft: '#DBEAFE',
  accent: '#0F766E',
  accentSoft: '#CCFBF1',
  secondary: '#0F766E',
  success: '#16A34A',
  successSoft: '#DCFCE7',
  warning: '#D97706',
  warningSoft: '#FEF3C7',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  info: '#0284C7',
  infoSoft: '#E0F2FE',
  light: '#F6F8FB',
  dark: '#111827',
  background: '#F6F8FB',
  surface: '#EEF2F7',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#F8FAFC',
  text: '#111827',
  textSecondary: '#64748B',
  textTertiary: '#94A3B8',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  disabled: '#CBD5E1',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

export const RADIUS = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
  pill: 999,
};

export const TYPOGRAPHY = {
  screenTitle: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  sectionTitle: { fontSize: 17, fontWeight: '700', lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 21 },
  meta: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
};

export const SHADOWS = {
  card: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  floating: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 6,
  },
};

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

export const MATERIAL_TYPES = {
  PLA: 'PLA',
  PETG: 'PETG',
  ABS: 'ABS',
  TPU: 'TPU',
  OTHER: '其它材质',
};

export const UNITS = {
  GRAM: 'g',
  KILOGRAM: 'kg',
  METER: 'm',
  PIECE: '个',
};

export const UPLOAD_LIMITS = {
  MAX_FILE_SIZE: 500 * 1024 * 1024,
  CHUNK_SIZE: 5 * 1024 * 1024,
  URL_EXPIRY: 10 * 60 * 1000,
};

// API base URL 解析顺序：
//   1. 环境变量 EXPO_PUBLIC_API_BASE_URL（部署到生产时显式指定）
//   2. 开发模式且检测到 Expo 主机时，使用 LAN IP（手机/真机调试）
//   3. 兜底为本地后端 http://localhost:5000/api
// 不再硬编码任何远程服务器 IP —— 部署时通过环境变量注入。
const DEFAULT_API_PORT = 5000;

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
      return `http://${expoHost}:${DEFAULT_API_PORT}/api`;
    }
  }

  return `http://localhost:${DEFAULT_API_PORT}/api`;
};

const DEFAULT_API_BASE_URL = getDefaultApiBaseUrl();

export const API_CONFIG = {
  BASE_URL: DEFAULT_API_BASE_URL,
  TIMEOUT: 30000,
};

if (typeof __DEV__ !== 'undefined' && __DEV__) {
  const expoHost = getExpoHost();
  const source = process.env?.EXPO_PUBLIC_API_BASE_URL
    ? 'env:EXPO_PUBLIC_API_BASE_URL'
    : (typeof expoHost === 'string' && expoHost)
      ? `dev:expoHost(${expoHost}:${DEFAULT_API_PORT})`
      : 'fallback:localhost';
  // eslint-disable-next-line no-console
  console.log(`[API] BASE_URL = ${DEFAULT_API_BASE_URL} (source=${source})`);
}

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
  AGENT: 'Agent',
  AGENT_CHAT: 'AgentChat',
  AGENT_SETTINGS: 'AgentSettings',
};

export const SCREEN_TITLES = {
  [ROUTES.HOME]: '首页',
  [ROUTES.ORDERS]: '订单',
  [ROUTES.MODELS]: '模型',
  [ROUTES.MATERIALS]: '耗材',
  [ROUTES.ORDER_DETAIL]: '订单详情',
  [ROUTES.CREATE_ORDER]: '新建订单',
  [ROUTES.MODEL_DETAIL]: '模型详情',
  [ROUTES.CREATE_MODEL]: '新建模型',
  [ROUTES.MATERIAL_DETAIL]: '耗材详情',
  [ROUTES.CREATE_MATERIAL]: '新建耗材',
  [ROUTES.INBOUND_TRANSACTION]: '入库操作',
  [ROUTES.OUTBOUND_TRANSACTION]: '出库操作',
  [ROUTES.ADJUST_TRANSACTION]: '库存盘点',
  [ROUTES.OSS_CONFIG]: 'OSS 配置',
  [ROUTES.DATA_IMPORT]: '数据导入',
  [ROUTES.AGENT]: 'AI 助手',
  [ROUTES.AGENT_CHAT]: 'AI 助手',
  [ROUTES.AGENT_SETTINGS]: 'AI 服务设置',
};
