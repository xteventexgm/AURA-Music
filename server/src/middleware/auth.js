import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { isMongoConnected } from '../config/db.js';

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado', message: 'Token de sesión requerido' });
  }

  const token = authHeader.split(' ')[1];
  const secret = process.env.JWT_SECRET || 'aura_music_jwt_secret_super_secure_key_2026_change_in_production';

  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch (jwtErr) {
    // Error explícito de JWT (expirado, firma inválida o malformado)
    return res.status(401).json({ error: 'Token inválido o expirado', details: jwtErr.message });
  }

  // Si MongoDB Atlas todavía no está conectado o está reconectando tras un reinicio del servidor:
  if (!isMongoConnected()) {
    // El token JWT es matemáticamente válido; creamos un objeto seguro del usuario
    // para no rechazar la petición con 401 ni cerrar la sesión del cliente
    req.user = {
      _id: decoded.id,
      id: decoded.id,
      email: decoded.email,
      username: decoded.username,
      toSafeObject: () => ({
        id: decoded.id,
        email: decoded.email,
        username: decoded.username
      })
    };
    return next();
  }

  try {
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'No autorizado', message: 'Usuario no encontrado' });
    }
    req.user = user;
    next();
  } catch (dbErr) {
    console.warn('[requireAuth Atlas Warning]: Consulta temporalmente lenta o reconectando:', dbErr.message);
    // Para evitar desloguear al usuario por un hipo de red o reinicio del cluster:
    req.user = {
      _id: decoded.id,
      id: decoded.id,
      email: decoded.email,
      username: decoded.username,
      toSafeObject: () => ({
        id: decoded.id,
        email: decoded.email,
        username: decoded.username
      })
    };
    next();
  }
}
