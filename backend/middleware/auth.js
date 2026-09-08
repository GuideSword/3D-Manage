const { withData } = require('../utils/store');
const { verifyToken } = require('../utils/authTokens');

const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  active: user.active !== false,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const readToken = (req) => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

const authenticate = async (req) => {
  const token = readToken(req);
  if (!token) {
    return null;
  }

  return withData((data) => {
    const payload = verifyToken(token, data.system.serverId);
    const user = data.users.find((item) => item.id === String(payload.sub));
    if (
      !user
      || user.active === false
      || !Number.isInteger(user.tokenVersion)
      || payload.ver !== user.tokenVersion
    ) {
      return null;
    }
    return publicUser(user);
  }, { write: false });
};

const requireAuth = async (req, res, next) => {
  try {
    const user = await authenticate(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const requireRoles = (...roles) => async (req, res, next) => {
  try {
    const user = await authenticate(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = {
  requireAuth,
  requireRoles,
  publicUser,
};
