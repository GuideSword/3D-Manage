const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { withData, appendAudit, now } = require('../utils/store');
const { publicUser, requireAuth } = require('../middleware/auth');
const { issueToken } = require('../utils/authTokens');
const { createFailureLimiter } = require('../utils/rateLimit');
const { z } = require('zod');
const { parseRequest } = require('../utils/validation');

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const loginLimiter = createFailureLimiter({
  maxEnv: 'LOGIN_RATE_LIMIT_MAX',
  windowEnv: 'LOGIN_RATE_LIMIT_WINDOW_MS',
});

const passwordSchema = z.string()
  .min(12, '密码至少需要 12 个字符')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, '密码不能超过 72 个 UTF-8 字节');

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
}).strict();

const validateCredentials = ({ email, password }) => {
  if (!normalizeEmail(email)) {
    return '请输入邮箱';
  }
  if (!password || String(password).length < 8) {
    return '密码至少需要 8 个字符';
  }
  return null;
};

router.post('/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const limiterKey = loginLimiter.getKey(req, email);
    if (loginLimiter.isBlocked(limiterKey)) {
      return loginLimiter.reject(res);
    }
    const password = String(req.body.password || '');
    const validationError = validateCredentials({ email, password });
    if (validationError) {
      loginLimiter.recordFailure(limiterKey);
      return res.status(400).json({ error: validationError });
    }

    const result = await withData((data) => {
      if (!data.system.initializedAt) {
        return { notInitialized: true };
      }
      const user = data.users.find((item) => item.email === email);
      if (!user || user.active === false || !bcrypt.compareSync(password, user.passwordHash)) {
        return null;
      }
      user.lastLoginAt = now();
      appendAudit(data, {
        actorId: user.id,
        entity: 'users',
        entityId: user.id,
        action: 'login',
        diff: { email: user.email },
      });
      return { user, serverId: data.system.serverId };
    });

    if (result?.notInitialized) {
      return res.status(409).json({
        code: 'SYSTEM_NOT_INITIALIZED',
        error: '系统尚未初始化',
      });
    }
    if (!result) {
      loginLimiter.recordFailure(limiterKey);
      return res.status(401).json({ error: '账号或密码错误' });
    }

    loginLimiter.reset(limiterKey);
    return res.json({
      token: issueToken(result.user, result.serverId),
      user: publicUser(result.user),
    });
  } catch (error) {
    console.error('Login failed:', error);
    return res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ user: req.user });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const input = parseRequest(changePasswordSchema, req.body, res);
  if (!input) return undefined;

  try {
    const result = await withData((data) => {
      const user = data.users.find((item) => item.id === req.user.id);
      if (!user || !bcrypt.compareSync(input.currentPassword, user.passwordHash)) {
        return {
          status: 403,
          body: { code: 'CURRENT_PASSWORD_INVALID', error: '当前密码错误' },
        };
      }

      user.passwordHash = bcrypt.hashSync(input.newPassword, 12);
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      user.updatedAt = now();
      appendAudit(data, {
        actorId: user.id,
        entity: 'users',
        entityId: user.id,
        action: 'password.change',
        diff: { tokenVersion: user.tokenVersion },
      });
      return { status: 200, body: { success: true } };
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({ code: 'PASSWORD_CHANGE_FAILED', error: '修改密码失败，请稍后重试' });
  }
});

module.exports = router;
