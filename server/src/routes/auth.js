import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { isMongoConnected } from '../config/db.js';
import { uploadAvatarFile, deleteAvatarFile, getR2ObjectStream, isR2Configured } from '../services/r2Service.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_AVATARS_DIR = path.join(__dirname, '../../uploads/avatars');

// Configuración de Multer para recibir imágenes de avatar en memoria
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB máximo
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de imagen (JPEG, PNG, WEBP)'));
    }
  }
});

const getJwtSecret = () =>
  process.env.JWT_SECRET || 'aura_music_jwt_secret_super_secure_key_2026_change_in_production';

// Generar Token JWT válido por 30 días
function generateToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email, username: user.username },
    getJwtSecret(),
    { expiresIn: '30d' }
  );
}

// 1. Estado de los servicios Cloud (MongoDB Atlas y Cloudflare R2)
router.get('/status', (req, res) => {
  res.json({
    mongoAtlas: {
      connected: isMongoConnected(),
      status: isMongoConnected() ? 'online' : 'unconfigured_or_offline'
    },
    cloudflareR2: {
      configured: isR2Configured(),
      bucket: process.env.R2_BUCKET_NAME || 'aura-media'
    }
  });
});

// 2. Registro de Usuario
router.post('/register', async (req, res) => {
  if (!isMongoConnected()) {
    return res.status(503).json({
      error: 'MongoDB Atlas no configurado',
      message: 'Configura la variable MONGODB_URI en server/.env para habilitar el registro de usuarios.'
    });
  }

  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({ error: 'El correo electrónico ya está registrado' });
    }

    const user = new User({
      username: username.trim(),
      email: email.toLowerCase().trim(),
      password
    });

    await user.save();

    const token = generateToken(user);

    res.status(201).json({
      message: 'Usuario registrado exitosamente',
      token,
      user: user.toSafeObject()
    });
  } catch (err) {
    console.error('[Register Error]:', err);
    res.status(500).json({ error: 'Error al registrar usuario', details: err.message });
  }
});

// 3. Inicio de Sesión
router.post('/login', async (req, res) => {
  if (!isMongoConnected()) {
    return res.status(503).json({
      error: 'MongoDB Atlas no configurado',
      message: 'Configura la variable MONGODB_URI en server/.env para iniciar sesión.'
    });
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Correo y contraseña requeridos' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = generateToken(user);

    res.json({
      message: 'Sesión iniciada',
      token,
      user: user.toSafeObject()
    });
  } catch (err) {
    console.error('[Login Error]:', err);
    res.status(500).json({ error: 'Error al iniciar sesión', details: err.message });
  }
});

// 4. Obtener Perfil Actual
router.get('/me', requireAuth, async (req, res) => {
  res.json({
    user: req.user.toSafeObject()
  });
});

// 5. Actualizar Datos de Perfil (Nombre, Biografía, Preferencias)
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { username, bio, preferences } = req.body;

    if (username) req.user.username = username.trim();
    if (typeof bio === 'string') req.user.bio = bio.trim().slice(0, 160);
    if (preferences) req.user.preferences = { ...req.user.preferences, ...preferences };

    await req.user.save();

    res.json({
      message: 'Perfil actualizado',
      user: req.user.toSafeObject()
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar perfil', details: err.message });
  }
});

// 6. Subir Imagen de Perfil (Avatar a Cloudflare R2 con fallback local)
router.post('/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se envió ningún archivo de imagen' });
    }

    const oldAvatarUrl = req.user.avatarUrl;

    const newAvatarUrl = await uploadAvatarFile(
      req.user._id.toString(),
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    req.user.avatarUrl = newAvatarUrl;
    await req.user.save();

    // Eliminar avatar anterior en segundo plano (r2Service purga también proactivamente)
    if (oldAvatarUrl && oldAvatarUrl !== newAvatarUrl) {
      deleteAvatarFile(oldAvatarUrl).catch(() => {});
    }

    res.json({
      message: 'Foto de perfil actualizada exitosamente',
      avatarUrl: newAvatarUrl,
      user: req.user.toSafeObject()
    });
  } catch (err) {
    console.error('[Avatar Upload Error]:', err);
    res.status(500).json({ error: 'Error al subir foto de perfil', details: err.message });
  }
});

// 7. Servir avatar unificado (Prioridad Cloudflare R2 con fallback local transparente)
router.get('/avatar/:filename', async (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const key = `avatars/${filename}`;

    // A. Intentar desde Cloudflare R2
    if (isR2Configured()) {
      try {
        const result = await getR2ObjectStream(key);
        res.setHeader('Content-Type', result.ContentType || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return result.Body.pipe(res);
      } catch (r2Err) {
        // Objeto no encontrado en R2, intentar fallback local
      }
    }

    // B. Fallback local en disco
    const filePath = path.join(LOCAL_AVATARS_DIR, filename);
    if (fs.existsSync(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(filePath);
    }

    res.status(404).send('Avatar no encontrado');
  } catch (err) {
    console.error('Error sirviendo avatar:', err);
    res.status(500).send('Error interno al servir avatar');
  }
});

// 8. Rutas de compatibilidad histórica
router.get('/avatar-local/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  res.redirect(301, `/api/auth/avatar/${encodeURIComponent(filename)}`);
});

router.get('/avatar-stream/:key(*)', (req, res) => {
  try {
    const rawKey = req.params.key || req.params[0] || '';
    const decoded = decodeURIComponent(rawKey);
    const filename = path.basename(decoded);
    res.redirect(301, `/api/auth/avatar/${encodeURIComponent(filename)}`);
  } catch {
    res.status(404).send('Avatar no encontrado');
  }
});

export default router;
