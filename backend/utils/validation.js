const parseRequest = (schema, value, res) => {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  res.status(400).json({
    code: 'VALIDATION_FAILED',
    error: 'Request validation failed',
    details: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
  return null;
};

module.exports = { parseRequest };
