const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { requireRoles, publicUser } = require('../middleware/auth');
const { withData, nextId, appendAudit, now } = require('../utils/store');
const { parseRequest } = require('../utils/validation');

const router = express.Router();

const passwordSchema = z.string()
  .min(12, 'Password must be at least 12 characters')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes');

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: passwordSchema,
  role: z.enum(['staff', 'viewer']),
}).strict();

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(['staff', 'viewer']).optional(),
  active: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

const resetPasswordSchema = z.object({
  password: passwordSchema,
}).strict();

router.use(requireRoles('owner'));

router.get('/', async (req, res) => {
  try {
    const users = await withData(
      (data) => data.users.map(publicUser),
      { write: false }
    );
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ items: users, total: users.length });
  } catch (error) {
    return res.status(500).json({ code: 'USER_LIST_FAILED', error: 'Get users failed' });
  }
});

router.post('/', async (req, res) => {
  const input = parseRequest(createUserSchema, req.body, res);
  if (!input) return undefined;

  try {
    const result = await withData((data) => {
      if (data.users.some((item) => item.email === input.email)) {
        return {
          status: 409,
          body: { code: 'EMAIL_ALREADY_EXISTS', error: 'Email already registered' },
        };
      }

      const timestamp = now();
      const user = {
        id: nextId(data.users),
        name: input.name,
        email: input.email,
        role: input.role,
        active: true,
        tokenVersion: 1,
        passwordHash: bcrypt.hashSync(input.password, 12),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      data.users.push(user);
      appendAudit(data, {
        actorId: req.user.id,
        entity: 'users',
        entityId: user.id,
        action: 'create',
        diff: { name: user.name, email: user.email, role: user.role, active: user.active },
      });
      return { status: 201, body: publicUser(user) };
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({ code: 'USER_CREATE_FAILED', error: 'Create user failed' });
  }
});

router.patch('/:id', async (req, res) => {
  const input = parseRequest(updateUserSchema, req.body, res);
  if (!input) return undefined;

  try {
    const result = await withData((data) => {
      const user = data.users.find((item) => item.id === String(req.params.id));
      if (!user) {
        return { status: 404, body: { code: 'USER_NOT_FOUND', error: 'User not found' } };
      }
      if (user.role === 'owner') {
        return {
          status: 409,
          body: { code: 'OWNER_MANAGED_SEPARATELY', error: 'Owner accounts cannot be changed here' },
        };
      }

      const before = publicUser(user);
      const roleChanged = input.role !== undefined && input.role !== user.role;
      const deactivated = input.active === false && user.active !== false;

      if (input.name !== undefined) user.name = input.name;
      if (input.role !== undefined) user.role = input.role;
      if (input.active !== undefined) user.active = input.active;
      if (roleChanged || deactivated) {
        user.tokenVersion = (user.tokenVersion || 0) + 1;
      }
      user.updatedAt = now();

      const after = publicUser(user);
      appendAudit(data, {
        actorId: req.user.id,
        entity: 'users',
        entityId: user.id,
        action: 'update',
        diff: { before, after },
      });
      return { status: 200, body: after };
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({ code: 'USER_UPDATE_FAILED', error: 'Update user failed' });
  }
});

router.post('/:id/reset-password', async (req, res) => {
  const input = parseRequest(resetPasswordSchema, req.body, res);
  if (!input) return undefined;

  try {
    const result = await withData((data) => {
      const user = data.users.find((item) => item.id === String(req.params.id));
      if (!user) {
        return { status: 404, body: { code: 'USER_NOT_FOUND', error: 'User not found' } };
      }
      if (user.role === 'owner') {
        return {
          status: 409,
          body: { code: 'OWNER_MANAGED_SEPARATELY', error: 'Owner password cannot be reset here' },
        };
      }

      user.passwordHash = bcrypt.hashSync(input.password, 12);
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      user.updatedAt = now();
      appendAudit(data, {
        actorId: req.user.id,
        entity: 'users',
        entityId: user.id,
        action: 'password.reset',
        diff: { tokenVersion: user.tokenVersion },
      });
      return { status: 200, body: { success: true, user: publicUser(user) } };
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({ code: 'PASSWORD_RESET_FAILED', error: 'Reset password failed' });
  }
});

module.exports = router;
