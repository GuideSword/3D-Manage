import { ORDER_STATUSES, ORDER_STATUS_LABELS } from '../constants';

const FLOW_ORDER = [
  ORDER_STATUSES.DRAFT,
  ORDER_STATUSES.PENDING_REVIEW,
  ORDER_STATUSES.IN_PROGRESS,
  ORDER_STATUSES.COMPLETED,
];

const getFlowIndex = (status) => FLOW_ORDER.indexOf(status);

// 必须与后端 backend/routes/orders.js 中的 allowedTransitions 保持一致
export const ALLOWED_TRANSITIONS = {
  [ORDER_STATUSES.DRAFT]: [
    ORDER_STATUSES.PENDING_REVIEW,
    ORDER_STATUSES.CANCELLED,
  ],
  [ORDER_STATUSES.PENDING_REVIEW]: [
    ORDER_STATUSES.IN_PROGRESS,
    ORDER_STATUSES.CANCELLED,
    ORDER_STATUSES.DRAFT,
  ],
  [ORDER_STATUSES.IN_PROGRESS]: [
    ORDER_STATUSES.COMPLETED,
    ORDER_STATUSES.CANCELLED,
    ORDER_STATUSES.PENDING_REVIEW,
    ORDER_STATUSES.DRAFT,
  ],
  [ORDER_STATUSES.COMPLETED]: [
    ORDER_STATUSES.IN_PROGRESS,
    ORDER_STATUSES.PENDING_REVIEW,
    ORDER_STATUSES.DRAFT,
    ORDER_STATUSES.CANCELLED,
  ],
  [ORDER_STATUSES.CANCELLED]: [
    ORDER_STATUSES.DRAFT,
  ],
};

export const isAllowedTransition = (fromStatus, toStatus) => {
  if (!fromStatus || !toStatus) {
    return false;
  }
  if (fromStatus === toStatus) {
    return true;
  }
  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  if (!allowed) {
    return false;
  }
  return allowed.includes(toStatus);
};

export const getAllowedNextStatuses = (fromStatus) => (
  ALLOWED_TRANSITIONS[fromStatus] || []
);

// 没有"出向"转换的状态（cancelled 不算，因为它有到 draft 的恢复通道）
export const isTerminalStatus = (status) => {
  const allowed = ALLOWED_TRANSITIONS[status];
  return Array.isArray(allowed) && allowed.length === 0;
};

// 是否支持"恢复"操作（cancelled → draft）
export const isRestorable = (status) => (
  status === ORDER_STATUSES.CANCELLED
);

// 恢复动作的目标状态
export const getRestoreTarget = (status) => {
  if (!isRestorable(status)) {
    return null;
  }
  return ORDER_STATUSES.DRAFT;
};

export const isDowngrade = (fromStatus, toStatus) => {
  if (!isAllowedTransition(fromStatus, toStatus)) {
    return false;
  }
  const fromIndex = getFlowIndex(fromStatus);
  const toIndex = getFlowIndex(toStatus);
  if (fromIndex === -1 || toIndex === -1) {
    return false;
  }
  return toIndex < fromIndex;
};

export const getDowngradeSteps = (fromStatus, toStatus) => {
  const fromIndex = getFlowIndex(fromStatus);
  const toIndex = getFlowIndex(toStatus);
  if (fromIndex === -1 || toIndex === -1) {
    return 0;
  }
  return Math.max(0, fromIndex - toIndex);
};

export const isReopen = (fromStatus, toStatus) => (
  fromStatus === ORDER_STATUSES.COMPLETED
  && toStatus !== ORDER_STATUSES.COMPLETED
  && toStatus !== ORDER_STATUSES.CANCELLED
);

export const getDowngradeTitle = (fromStatus, toStatus) => {
  if (isReopen(fromStatus, toStatus)) {
    return '重新打开已完成的订单';
  }
  return '退级操作确认';
};

export const getDowngradeMessage = (fromStatus, toStatus) => {
  const fromLabel = ORDER_STATUS_LABELS[fromStatus] || '未知';
  const toLabel = ORDER_STATUS_LABELS[toStatus] || '未知';
  const reopen = isReopen(fromStatus, toStatus);

  const lines = [
    `从"${fromLabel}"退回"${toLabel}"属于${reopen ? '重新打开' : '退级'}操作。`,
    '',
    '可能造成的影响：',
    '• 已进行的工作需要重新评估',
    '• 已分配的库存/材料可能需要调整',
    '• 团队进度和排期可能需要重新安排',
    '• 客户/相关方可能需要重新沟通',
  ];

  if (reopen) {
    lines.push('• 已完成的工作流程需要重新启动');
  }

  lines.push('', '确定要继续吗？');
  return lines.join('\n');
};
