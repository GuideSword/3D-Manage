const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { z } = require('zod');
const { withData, nextId, appendAudit, now } = require('../utils/store');
const { publicUser, requireRoles } = require('../middleware/auth');
const { issueToken } = require('../utils/authTokens');
const { parseRequest } = require('../utils/validation');
const { createFailureLimiter } = require('../utils/rateLimit');
const {
  API_VERSION,
  PRODUCT_NAME,
  SERVER_VERSION,
} = require('../config/runtime');

const router = express.Router();

const passwordSchema = z.string()
  .min(12, '密码至少需要 12 个字符')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, '密码不能超过 72 个 UTF-8 字节');

const bootstrapSchema = z.object({
  organizationName: z.string().trim().min(1).max(120),
  ownerName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: passwordSchema,
}).strict();

const organizationSchema = z.object({
  organizationName: z.string().trim().min(1).max(120),
}).strict();

const bootstrapLimiter = createFailureLimiter({
  maxEnv: 'BOOTSTRAP_RATE_LIMIT_MAX',
  windowEnv: 'BOOTSTRAP_RATE_LIMIT_WINDOW_MS',
});

const secretsMatch = (provided, configured) => {
  if (!provided || !configured) return false;
  const left = crypto.createHash('sha256').update(String(provided)).digest();
  const right = crypto.createHash('sha256').update(String(configured)).digest();
  return crypto.timingSafeEqual(left, right);
};

router.get('/info', async (req, res) => {
  try {
    const info = await withData((data) => ({
      product: PRODUCT_NAME,
      serverId: data.system.serverId,
      organizationName: data.system.organizationName,
      initialized: Boolean(data.system.initializedAt),
      apiVersion: API_VERSION,
      serverVersion: SERVER_VERSION,
      capabilities: {
        agent: process.env.AGENT_ENABLED !== 'false',
        objectStorage: process.env.OSS_ENABLED === 'true',
        selfHosted: true,
      },
    }), { write: false });

    res.setHeader('Cache-Control', 'no-store');
    return res.json(info);
  } catch (error) {
    return res.status(503).json({
      code: 'STORAGE_UNAVAILABLE',
      error: '服务器存储暂不可用',
    });
  }
});

router.post('/bootstrap', async (req, res) => {
  const limiterKey = bootstrapLimiter.getKey(req);
  if (bootstrapLimiter.isBlocked(limiterKey)) {
    return bootstrapLimiter.reject(res);
  }

  if (!secretsMatch(req.get('X-Bootstrap-Token'), process.env.BOOTSTRAP_TOKEN)) {
    bootstrapLimiter.recordFailure(limiterKey);
    return res.status(403).json({
      code: 'BOOTSTRAP_TOKEN_INVALID',
      error: '初始化令牌无效',
    });
  }

  const input = parseRequest(bootstrapSchema, req.body, res);
  if (!input) return undefined;

  try {
    const created = await withData((data) => {
      if (data.system.initializedAt || data.users.length > 0) {
        return {
          status: 409,
          body: {
            code: 'SYSTEM_ALREADY_INITIALIZED',
            error: '系统已完成初始化',
          },
        };
      }

      const timestamp = now();
      const owner = {
        id: nextId(data.users),
        email: input.email,
        name: input.ownerName,
        role: 'owner',
        active: true,
        tokenVersion: 1,
        passwordHash: bcrypt.hashSync(input.password, 12),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      data.users.push(owner);
      data.system.organizationName = input.organizationName;
      data.system.initializedAt = timestamp;
      appendAudit(data, {
        actorId: owner.id,
        entity: 'system',
        entityId: data.system.serverId,
        action: 'bootstrap',
        diff: { organizationName: input.organizationName, ownerEmail: owner.email },
      });

      return {
        status: 201,
        body: {
          user: publicUser(owner),
          token: issueToken(owner, data.system.serverId),
          serverId: data.system.serverId,
        },
      };
    });

    if (created.status === 201) bootstrapLimiter.reset(limiterKey);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(created.status).json(created.body);
  } catch (error) {
    console.error('System bootstrap failed:', error.message);
    return res.status(500).json({
      code: 'BOOTSTRAP_FAILED',
      error: '系统初始化失败',
    });
  }
});

router.patch('/organization', requireRoles('owner'), async (req, res) => {
  const input = parseRequest(organizationSchema, req.body, res);
  if (!input) return undefined;

  try {
    const organization = await withData((data) => {
      const before = data.system.organizationName;
      data.system.organizationName = input.organizationName;
      appendAudit(data, {
        actorId: req.user.id,
        entity: 'system',
        entityId: data.system.serverId,
        action: 'organization.update',
        diff: { before, after: input.organizationName },
      });
      return { organizationName: data.system.organizationName };
    });
    return res.json(organization);
  } catch (error) {
    return res.status(500).json({ code: 'ORGANIZATION_UPDATE_FAILED', error: '更新组织信息失败' });
  }
});

module.exports = router;
