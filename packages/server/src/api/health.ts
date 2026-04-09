import { Router } from 'express';

const startTime = Date.now();

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
});

export { router as healthRouter };
