import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { validateApiKey } from '../auth/keys.js';
import { loginSchema } from '../../../shared/src/validation.js';

const router = Router();

router.post('/auth/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    return;
  }

  const identity = validateApiKey(parsed.data.apiKey);
  if (!identity) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  const token = jwt.sign(
    { type: identity.type, sender: identity.sender, agentId: identity.agentId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );

  res.json({ token, expiresIn: config.jwtExpiresIn });
});

export { router as authRouter };
