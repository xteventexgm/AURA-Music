import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import musicRouter from './routes/music.js';
import authRouter from './routes/auth.js';
import userSyncRouter from './routes/userSync.js';
import { connectDB, isMongoConnected } from './config/db.js';
import { isR2Configured } from './services/r2Service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carga robusta de .env en cualquier entorno (Electron Desktop, Vite o Server directo)
const envPaths = [
  path.join(__dirname, '../.env'),
  path.join(__dirname, '../../.env'),
  path.resolve(process.cwd(), 'server/.env'),
  path.resolve(process.cwd(), '.env')
];
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares de Seguridad y Cabeceras
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false
  })
);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Limitadores de Tasa (Rate Limiting)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, por favor inténtalo de nuevo más tarde.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de autenticación. Espera 15 minutos.' }
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/google', authLimiter);

// Carpeta pública para avatares locales (fallback)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Logger de desarrollo
app.use((req, res, next) => {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

// Rutas de API
app.use('/api', musicRouter);
app.use('/api/auth', authRouter);
app.use('/api/sync', userSyncRouter);

// Estado de salud del servidor
const healthHandler = (req, res) => {
  res.json({
    status: 'ok',
    service: 'Aura Pro Media Engine',
    version: '2.0.0',
    mongoAtlas: isMongoConnected() ? 'connected' : 'offline_or_unconfigured',
    cloudflareR2: isR2Configured() ? 'ready' : 'fallback_local',
    timestamp: new Date().toISOString()
  });
};

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Servir frontend compilado estáticamente si existe (ideal para Render, VPS o nube)
const candidateDistPaths = [
  path.join(__dirname, '../../client/dist'),
  path.join(__dirname, '../client/dist'),
  path.resolve(process.cwd(), 'client/dist'),
  path.resolve(process.cwd(), 'dist')
];
const distFolder = candidateDistPaths.find((p) => fs.existsSync(path.join(p, 'index.html')));
if (distFolder) {
  app.use(express.static(distFolder));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/health')) {
      return next();
    }
    res.sendFile(path.join(distFolder, 'index.html'));
  });
}

// Iniciar servidor y conectar a MongoDB Atlas
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`===============================================`);
  console.log(`🚀 AURA PRO MEDIA SERVER OPERATIVO`);
  console.log(`🔊 Local:   http://localhost:${PORT}`);
  console.log(`📡 API:     http://localhost:${PORT}/api`);
  console.log(`📱 Red LAN: Escuchando en 0.0.0.0:${PORT} (Accesible desde móvil)`);
  console.log(`===============================================`);

  // Conexión tolerante a fallos a MongoDB Atlas
  await connectDB();
});
