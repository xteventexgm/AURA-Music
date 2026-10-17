import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { Playlist } from '../models/Playlist.js';
import { LikedTrack } from '../models/LikedTrack.js';
import { ListenHistory } from '../models/ListenHistory.js';
import { UserBackup } from '../models/UserBackup.js';
import { invalidateRecommendationCache } from '../services/recommendationService.js';

const router = express.Router();

// Todas las rutas de sincronización requieren usuario autenticado
router.use(requireAuth);

// 1. Obtener todos los datos sincronizados del usuario desde MongoDB Atlas
router.get('/data', async (req, res) => {
  try {
    const userId = req.user._id;

    const [playlists, likedTracks, backupsCount, historyCount] = await Promise.all([
      Playlist.find({ userId }).sort({ updatedAt: -1 }),
      LikedTrack.find({ userId }).sort({ likedAt: -1 }),
      UserBackup.countDocuments({ userId }),
      ListenHistory.countDocuments({ userId })
    ]);

    res.json({
      playlists: playlists.map((p) => ({
        id: p.localId || p._id.toString(),
        mongoId: p._id.toString(),
        name: p.name,
        description: p.description,
        coverUrl: p.coverUrl,
        tracks: p.tracks,
        updatedAt: p.updatedAt
      })),
      likedTracks: likedTracks.map((l) => ({
        id: l.trackId,
        title: l.title,
        artist: l.artist,
        duration: l.duration,
        thumbnail: l.thumbnail,
        likedAt: l.likedAt
      })),
      stats: {
        totalPlaylists: playlists.length,
        totalLiked: likedTracks.length,
        totalBackups: backupsCount,
        totalHistoryEvents: historyCount
      }
    });
  } catch (err) {
    console.error('[Sync Data Error]:', err);
    res.status(500).json({ error: 'Error al obtener datos de sincronización', details: err.message });
  }
});

// 2. Sincronizar Playlists (Subir / Actualizar playlists desde el cliente)
router.post('/playlists', async (req, res) => {
  try {
    const userId = req.user._id;
    const { playlists } = req.body;

    if (!Array.isArray(playlists)) {
      return res.status(400).json({ error: 'Se esperaba un array de playlists' });
    }

    // 1. Eliminar de Atlas las playlists que el usuario haya borrado en el cliente
    const activeLocalIds = playlists.map((p) => p.id).filter(Boolean);
    const activeNames = playlists.map((p) => (p.name || '').trim()).filter(Boolean);
    if (activeLocalIds.length > 0 || activeNames.length > 0) {
      await Playlist.deleteMany({
        userId,
        localId: { $nin: activeLocalIds },
        name: { $nin: activeNames }
      });
    } else {
      // Si el array enviado está completamente vacío, borrar todas las playlists de este usuario
      await Playlist.deleteMany({ userId });
    }

    // 2. Actualizar o insertar playlists preservando IDs y deduplicando pistas
    const savedPlaylists = [];
    for (const pl of playlists) {
      if (!pl || !pl.name) continue;

      // Deduplicar canciones dentro de la misma playlist por ID
      const seenTrackIds = new Set();
      const sanitizedTracks = [];
      for (const t of pl.tracks || []) {
        if (!t) continue;
        const tid = String(t.id || t.urlYoutube || t.url || '').trim();
        if (!tid || seenTrackIds.has(tid)) continue;
        seenTrackIds.add(tid);

        sanitizedTracks.push({
          id: tid,
          title: t.title || t.titulo || 'Sin título',
          artist: t.artist || t.artista || 'Artista Desconocido',
          duration: t.duration || t.duracion || '0:00',
          thumbnail: t.thumbnail || t.caratula || '',
          filename: t.filename || null
        });
      }

      const filter = pl.id ? { userId, localId: pl.id } : { userId, name: pl.name.trim() };
      const updateData = {
        userId,
        localId: pl.id || `pl-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        name: pl.name.trim(),
        description: pl.description || '',
        coverUrl: pl.coverUrl || '',
        tracks: sanitizedTracks
      };

      const doc = await Playlist.findOneAndUpdate(filter, updateData, {
        upsert: true,
        returnDocument: 'after',
        setDefaultsOnInsert: true
      });
      savedPlaylists.push(doc);
    }

    res.json({
      message: 'Playlists sincronizadas exitosamente en MongoDB Atlas',
      count: savedPlaylists.length
    });
  } catch (err) {
    console.error('[Sync Playlists Error]:', err);
    res.status(500).json({ error: 'Error al sincronizar playlists', details: err.message });
  }
});

// 3. Sincronizar Canciones Favoritas (Likes)
router.post('/likes', async (req, res) => {
  try {
    const userId = req.user._id;
    const { likedTracks } = req.body;

    if (!Array.isArray(likedTracks)) {
      return res.status(400).json({ error: 'Se esperaba un array de favoritos' });
    }

    // 1. Deduplicar pistas por ID en memoria para prevenir errores E11000 en bulkWrite
    const seenIds = new Set();
    const uniqueTracks = [];

    for (const t of likedTracks) {
      if (!t) continue;
      const trackId = String(t.id || t.urlYoutube || t.url || '').trim();
      if (!trackId || seenIds.has(trackId)) continue;
      seenIds.add(trackId);

      let validLikedAt = new Date();
      if (t.likedAt) {
        const parsed = new Date(t.likedAt);
        if (!isNaN(parsed.getTime())) {
          validLikedAt = parsed;
        }
      }

      uniqueTracks.push({
        trackId,
        title: String(t.title || t.titulo || 'Sin título').trim(),
        artist: String(t.artist || t.artista || 'Artista Desconocido').trim(),
        duration: String(t.duration || t.duracion || '0:00').trim(),
        thumbnail: String(t.thumbnail || t.caratula || '').trim(),
        likedAt: validLikedAt
      });
    }

    // 2. Eliminar de Atlas los favoritos que el usuario haya desmarcado (unliked)
    const activeTrackIds = Array.from(seenIds);
    await LikedTrack.deleteMany({
      userId,
      trackId: { $nin: activeTrackIds }
    });

    // 3. Si hay canciones activas, aplicar bulk upsert seguro
    if (uniqueTracks.length > 0) {
      const bulkOps = uniqueTracks.map((t) => ({
        updateOne: {
          filter: { userId, trackId: t.trackId },
          update: {
            $set: {
              userId,
              trackId: t.trackId,
              title: t.title,
              artist: t.artist,
              duration: t.duration,
              thumbnail: t.thumbnail,
              likedAt: t.likedAt
            }
          },
          upsert: true
        }
      }));

      await LikedTrack.bulkWrite(bulkOps, { ordered: false });
    }

    // Invalidar cache de recomendaciones para recalcular con los nuevos gustos
    invalidateRecommendationCache(userId);

    res.json({
      message: 'Favoritos sincronizados exitosamente en MongoDB Atlas',
      count: uniqueTracks.length
    });
  } catch (err) {
    console.error('[Sync Likes Error]:', err);
    res.status(500).json({ error: 'Error al sincronizar favoritos', details: err.message });
  }
});

// 4. Registrar evento de escucha para recomendaciones e historial
router.post('/history', async (req, res) => {
  try {
    const userId = req.user._id;
    const { trackId, title, artist, duration, thumbnail, listenedSeconds, completed } = req.body;

    if (!trackId || !title) {
      return res.status(400).json({ error: 'trackId y title son obligatorios' });
    }

    const event = new ListenHistory({
      userId,
      trackId,
      title,
      artist: artist || 'Artista Desconocido',
      duration: duration || '0:00',
      thumbnail: thumbnail || '',
      listenedSeconds: Number(listenedSeconds) || 0,
      completed: Boolean(completed)
    });

    await event.save();

    // Invalidar cache de recomendaciones para reflejar la última escucha
    invalidateRecommendationCache(userId);

    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error registrando historial', details: err.message });
  }
});

// 5. Crear Snapshot de Copia de Seguridad en MongoDB Atlas
router.post('/backup', async (req, res) => {
  try {
    const userId = req.user._id;
    const { name, playlists, likedTracks } = req.body;

    const backup = new UserBackup({
      userId,
      name: name || `Respaldo Nube - ${new Date().toLocaleDateString('es-ES')}`,
      trackCount: (playlists || []).reduce((acc, pl) => acc + (pl.tracks?.length || 0), 0) + (likedTracks?.length || 0),
      playlistCount: (playlists || []).length,
      payload: {
        playlists: playlists || [],
        likedTracks: likedTracks || []
      }
    });

    await backup.save();

    // Mantener sólo las últimas 5 copias en la nube para optimizar almacenamiento
    const userBackups = await UserBackup.find({ userId }).sort({ createdAt: -1 });
    if (userBackups.length > 5) {
      const toDelete = userBackups.slice(5);
      await UserBackup.deleteMany({ _id: { $in: toDelete.map((b) => b._id) } });
    }

    res.status(201).json({
      message: 'Copia de seguridad guardada en MongoDB Atlas',
      backup: {
        id: backup._id,
        name: backup.name,
        trackCount: backup.trackCount,
        playlistCount: backup.playlistCount,
        createdAt: backup.createdAt
      }
    });
  } catch (err) {
    console.error('[Create Backup Error]:', err);
    res.status(500).json({ error: 'Error al crear copia de seguridad', details: err.message });
  }
});

// 6. Listar Copias de Seguridad del Usuario
router.get('/backups', async (req, res) => {
  try {
    const userId = req.user._id;
    const backups = await UserBackup.find({ userId }).sort({ createdAt: -1 });

    res.json(
      backups.map((b) => ({
        id: b._id,
        name: b.name,
        trackCount: b.trackCount,
        playlistCount: b.playlistCount,
        createdAt: b.createdAt
      }))
    );
  } catch (err) {
    res.status(500).json({ error: 'Error al listar copias de seguridad', details: err.message });
  }
});

// 7. Restaurar Copia de Seguridad desde Snapshot
router.post('/restore/:backupId', async (req, res) => {
  try {
    const userId = req.user._id;
    const backup = await UserBackup.findOne({ _id: req.params.backupId, userId });

    if (!backup) {
      return res.status(404).json({ error: 'Copia de seguridad no encontrada' });
    }

    res.json({
      message: 'Copia de seguridad lista para restaurar',
      payload: backup.payload
    });
  } catch (err) {
    res.status(500).json({ error: 'Error restaurando copia', details: err.message });
  }
});

// 8. Eliminar Copia de Seguridad
router.delete('/backup/:backupId', async (req, res) => {
  try {
    const userId = req.user._id;
    await UserBackup.deleteOne({ _id: req.params.backupId, userId });
    res.json({ message: 'Copia de seguridad eliminada' });
  } catch (err) {
    res.status(500).json({ error: 'Error eliminando copia', details: err.message });
  }
});

export default router;
