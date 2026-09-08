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

router.use(requireRoles('owner'));

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

module.exports = router;
