const localizeValidationIssue = (issue = {}) => {
  if (/\p{Script=Han}/u.test(String(issue.message || ''))) return issue.message;
  if (issue.code === 'invalid_string' && issue.validation === 'email') return '邮箱格式无效';
  if (issue.code === 'unrecognized_keys') return `包含不支持的字段：${(issue.keys || []).join('、')}`;
  if (issue.code === 'invalid_type') return '字段类型无效';
  if (issue.code === 'too_small') return '字段内容过短或数量不足';
  if (issue.code === 'too_big') return '字段内容过长或数量过多';
  return '字段值无效';
};

const parseRequest = (schema, value, res) => {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  res.status(400).json({
    code: 'VALIDATION_FAILED',
    error: '请求参数校验失败',
    details: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: localizeValidationIssue(issue),
    })),
  });
  return null;
};

module.exports = { localizeValidationIssue, parseRequest };
