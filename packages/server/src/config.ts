import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Try multiple paths: monorepo root from source or dist
dotenvConfig({ path: resolve(__dirname, '../../../.env') });
dotenvConfig({ path: resolve(__dirname, '../../../../../.env') });
dotenvConfig({ path: resolve(process.cwd(), '.env') });

export const config = {
  port: parseInt(process.env.PORT ?? '3101', 10),
  host: process.env.HOST ?? '0.0.0.0',

  jwtSecret: process.env.JWT_SECRET ?? 'boardroom-dev-secret-change-me',
  jwtExpiresIn: parseInt(process.env.JWT_EXPIRES_IN ?? '3600', 10),

  adminApiKey: process.env.ADMIN_API_KEY ?? 'admin-dev-key',

  agentKeys: {
    asus: process.env.ASUS_API_KEY ?? 'asus-dev-key',
    water: process.env.WATER_API_KEY ?? 'water-dev-key',
    steam: process.env.STEAM_API_KEY ?? 'steam-dev-key',
  },

  dbPath: process.env.DB_PATH ?? 'data/boardroom.db',

  heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS ?? '15000', 10),
  heartbeatTimeoutMs: parseInt(process.env.HEARTBEAT_TIMEOUT_MS ?? '5000', 10),
  heartbeatMaxMisses: parseInt(process.env.HEARTBEAT_MAX_MISSES ?? '3', 10),

  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',

  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  enableAdvisors: process.env.ENABLE_ADVISORS !== 'false',
  oracleModel: process.env.ORACLE_MODEL ?? 'anthropic/claude-haiku-4.5',
  sageModel: process.env.SAGE_MODEL ?? 'anthropic/claude-haiku-4.5',
  extractionModel: process.env.EXTRACTION_MODEL ?? 'anthropic/claude-haiku-4.5',

  // Autonomy settings
  autoApproveRiskLevels: (process.env.AUTO_APPROVE_RISK ?? 'low').split(',') as Array<'low' | 'medium' | 'high'>,
  maxReconvenes: parseInt(process.env.MAX_RECONVENES ?? '3', 10),
  emergencyFailureThreshold: parseInt(process.env.EMERGENCY_FAILURE_THRESHOLD ?? '3', 10),
  emergencyTaskTimeoutMs: parseInt(process.env.EMERGENCY_TASK_TIMEOUT_MS ?? '600000', 10),
  reconveneBatchDelayMs: parseInt(process.env.RECONVENE_BATCH_DELAY_MS ?? '5000', 10),
  workspacePath: process.env.WORKSPACE_PATH ?? '/mnt/d/AI/brain/projects',
  remoteWorkspaceBase: process.env.REMOTE_WORKSPACE_BASE ?? 'D:\\boardroom',
  autonomousRounds: process.env.AUTONOMOUS_ROUNDS !== 'false',

  // NATS — fleet task distribution
  natsUrl: process.env.NATS_URL ?? 'nats://localhost:4222',
  natsToken: process.env.NATS_AUTH_TOKEN ?? '',
  natsEnabled: process.env.NATS_ENABLED !== 'false',

  // AI Chairman
  chairmanEnabled: process.env.CHAIRMAN_ENABLED !== 'false',
  chairmanModel: process.env.CHAIRMAN_MODEL ?? 'anthropic/claude-sonnet-4',
  chairmanMaxInterventions: parseInt(process.env.CHAIRMAN_MAX_INTERVENTIONS ?? '6', 10),
} as const;
