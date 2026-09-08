const jwt = require('jsonwebtoken');
const { API_VERSION } = require('../config/runtime');

const TOKEN_AUDIENCE = `3d-manage-api-v${API_VERSION}`;

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is required');
  }
  return secret;
};

const issuerForServer = (serverId) => `3d-manage:${serverId}`;

const issueToken = (user, serverId) => jwt.sign(
  {
    sub: String(user.id),
    email: user.email,
    role: user.role,
    ver: user.tokenVersion,
  },
  getJwtSecret(),
  {
    algorithm: 'HS256',
    audience: TOKEN_AUDIENCE,
    issuer: issuerForServer(serverId),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  }
);

const verifyToken = (token, serverId) => jwt.verify(token, getJwtSecret(), {
  algorithms: ['HS256'],
  audience: TOKEN_AUDIENCE,
  issuer: issuerForServer(serverId),
});

module.exports = {
  TOKEN_AUDIENCE,
  issueToken,
  verifyToken,
};
