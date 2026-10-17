import express from 'express';
import path from 'path';
import fs from 'fs';
import { searchTracks, getTrendingTracks } from '../services/searchService.js';
import {
  handleStreamRequest,
  handleStreamDownload,
  downloadTrack,
  getDownloadedTracks,
  deleteDownloadedTrack,
  getStorageStats,
  resolveStreamInfo,
  downloadsDir
} from '../services/streamService.js';
import { getLyrics } from '../services/lyricsService.js';
import { importFromUrl } from '../services/importService.js';
import { getPersonalizedFeed } from '../services/recommendationService.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

// 1. Búsqueda directa sin cuotas
router.get('/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Parámetro q requerido' });

  try {
    const tracks = await searchTracks(query);
    res.json({ results: tracks });
  } catch (err) {
    res.status(500).json({ error: 'Fallo al buscar pistas', details: err.message });
  }
});

// 2. Tendencias y recomendaciones de inicio
router.get('/trending', async (req, res) => {
  const category = req.query.category || 'pop';
  try {
    const tracks = await getTrendingTracks(category);
    res.json({ category, tracks });
  } catch (err) {
    res.status(500).json({ error: 'Error cargando tendencias', details: err.message });
  }
});

// 2.1 Feed Inteligente de Recomendaciones Personalizadas (Atlas & Telemetría)
router.get('/recommendations', async (req, res) => {
  let userId = null;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET || 'aura_music_jwt_secret_super_secure_key_2026_change_in_production';
    try {
      const decoded = jwt.verify(token, secret);
      userId = decoded.id;
    } catch {}
  }

  try {
    const feed = await getPersonalizedFeed(userId);
    res.json({ success: true, feed });
  } catch (err) {
    console.error('[Recommendations Error]:', err);
    res.status(500).json({ error: 'Error obteniendo recomendaciones', details: err.message });
  }
});

// Importar canción o playlist completa desde URL de YouTube
router.post('/import', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Parámetro url es requerido' });
  }

  try {
    const result = await importFromUrl(url);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Streaming en vivo (HTTP 206 Range)
router.get('/stream/:id', async (req, res) => {
  const videoId = req.params.id;
  if (!videoId) return res.status(400).json({ error: 'ID de canción requerido' });

  await handleStreamRequest(req, res, videoId);
});

// 3.1 Pre-calentamiento predictivo de la siguiente canción (N+1 background prewarm)
router.get('/stream/prewarm/:id', async (req, res) => {
  const videoId = req.params.id;
  if (!videoId) return res.status(400).json({ error: 'ID de canción requerido' });

  try {
    const info = await resolveStreamInfo(videoId);
    res.json({ prewarmed: true, videoId, title: info.title });
  } catch (err) {
    res.status(500).json({ prewarmed: false, error: err.message });
  }
});

// 4. Descarga directa por streaming al cliente (0 escrituras en disco del servidor)
router.get('/stream/download/:id', async (req, res) => {
  const videoId = req.params.id;
  const { title } = req.query;
  if (!videoId) return res.status(400).json({ error: 'ID de canción requerido' });

  await handleStreamDownload(req, res, videoId, title);
});

router.get('/download/stream/:id', async (req, res) => {
  const videoId = req.params.id;
  const { title } = req.query;
  if (!videoId) return res.status(400).json({ error: 'ID de canción requerido' });

  await handleStreamDownload(req, res, videoId, title);
});

// Endpoint de metadatos de descarga sin almacenamiento en servidor
router.get('/download/:id', async (req, res) => {
  const videoId = req.params.id;
  const { title } = req.query;

  try {
    const result = await downloadTrack(videoId, title || videoId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Error al procesar stream de descarga', details: err.message });
  }
});

// 5. Descarga directa del archivo MP3 al cliente (Móvil / Web / Desktop)
router.get('/download/file/:filename', (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(downloadsDir, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo de audio no encontrado' });
  }

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
  res.setHeader('Content-Type', 'audio/mpeg');
  fs.createReadStream(filePath).pipe(res);
});

// 6. Descarga directa de la carátula JPG al cliente (Móvil / Web / Desktop)
router.get('/download/cover/:filename', (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(downloadsDir, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Carátula no encontrada' });
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(filePath).pipe(res);
});

// 7. Servir carátula local para visualización en biblioteca offline
router.get('/library/cover/:filename', (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(downloadsDir, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Carátula no encontrada' });
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(filePath).pipe(res);
});

// 8. Letras sincronizadas
router.get('/lyrics', async (req, res) => {
  const { artist, track, duration } = req.query;
  if (!track) return res.status(400).json({ error: 'Parámetro track requerido' });

  const numDuration = duration ? parseFloat(duration) : null;
  const lyrics = await getLyrics(artist, track, numDuration);

  if (!lyrics) {
    return res.json({ found: false, hasSynced: false, synced: [], plain: null });
  }
  res.json({ found: true, ...lyrics });
});

// 9. Biblioteca local (Archivos descargados en el servidor)
router.get('/library', (req, res) => {
  try {
    const tracks = getDownloadedTracks();
    res.json({ library: tracks });
  } catch (err) {
    res.status(500).json({ error: 'Error leyendo biblioteca local' });
  }
});

// 10. Servir archivo de biblioteca local con soporte Range
router.get('/library/play/:filename', (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(downloadsDir, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo no encontrado' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'audio/mpeg'
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes'
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

// 11. Eliminar archivo local
router.delete('/library/:filename', (req, res) => {
  const success = deleteDownloadedTrack(req.params.filename);
  if (success) {
    res.json({ success: true, message: 'Archivo eliminado' });
  } else {
    res.status(404).json({ error: 'Archivo no encontrado' });
  }
});

// 12. Estadísticas de almacenamiento
router.get('/storage/stats', (req, res) => {
  try {
    const stats = getStorageStats();
    res.json({ success: true, ...stats });
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo estadísticas de almacenamiento' });
  }
});

export default router;
