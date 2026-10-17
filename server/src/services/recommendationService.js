import { ListenHistory } from '../models/ListenHistory.js';
import { LikedTrack } from '../models/LikedTrack.js';
import { searchTracks, getTrendingTracks } from './searchService.js';
import { isMongoConnected } from '../config/db.js';

// Cache en memoria para recomendaciones (TTL 5 minutos)
const recommendationCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateRecommendationCache(userId = null) {
  if (userId) {
    recommendationCache.delete(`feed_${userId}`);
  } else {
    recommendationCache.clear();
  }
}

/**
 * Filtra pistas candidatas garantizando 100% de unicidad contra pistas ya vistas
 * en secciones anteriores, evitando cualquier redundancia en la pantalla.
 */
function collectUniqueTracks(candidateTracks = [], seenTrackIds, maxCount = 15, excludeArtist = null) {
  const result = [];
  const normalizedExclude = excludeArtist ? excludeArtist.toLowerCase().trim() : null;

  for (const track of candidateTracks) {
    if (!track || !track.id) continue;
    if (seenTrackIds.has(track.id)) continue;

    // Si se especifica un artista a excluir (ej. para que "canciones similares" recomiende NUEVOS artistas)
    if (normalizedExclude && track.artist && track.artist.toLowerCase().includes(normalizedExclude)) {
      continue;
    }

    seenTrackIds.add(track.id);
    result.push(track);
    if (result.length >= maxCount) break;
  }
  return result;
}

/**
 * Genera la configuración de Mood / Ambiente dinámico según la hora local
 */
function getDynamicMoodConfig() {
  const hour = new Date().getHours();

  if (hour >= 23 || hour < 6) {
    return {
      type: 'night',
      title: 'Madrugada Lo-Fi & Chill',
      subtitle: 'Sonidos nocturnos, texturas suaves y beats relajantes para descansar',
      icon: 'moon',
      badgeColor: '#a855f7',
      query: 'lofi hip hop night chill beats study sleep instrumental'
    };
  } else if (hour >= 6 && hour < 12) {
    return {
      type: 'morning',
      title: 'Despertar & Mañanas Acústicas',
      subtitle: 'Melodías luminosas, café y acústico para empezar el día con armonía',
      icon: 'coffee',
      badgeColor: '#f59e0b',
      query: 'morning acoustic guitar chill coffee vibes peaceful'
    };
  } else if (hour >= 12 && hour < 18) {
    return {
      type: 'focus',
      title: 'Focus & Máxima Concentración',
      subtitle: 'Electrónica ambiental, synthwave y deep focus para trabajar o programar',
      icon: 'zap',
      badgeColor: '#eab308',
      query: 'synthwave chill deep focus beats programming instrumental'
    };
  } else {
    return {
      type: 'sunset',
      title: 'Energía & Sunset Vibes',
      subtitle: 'Hits rítmicos, electrónica y pop para activar la tarde y desconectar',
      icon: 'headphones',
      badgeColor: '#06b6d4',
      query: 'high energy pop dance sunset party hits 2026'
    };
  }
}

export async function getPersonalizedFeed(userId = null) {
  const cacheKey = userId ? `feed_${userId}` : 'feed_guest';
  const cached = recommendationCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // Set global de IDs para garantizar 0% redundancia entre todos los carruseles
  const seenTrackIds = new Set();
  const moodConfig = getDynamicMoodConfig();

  let topArtists = [];
  let recentTracks = [];
  let likedTracks = [];

  // 1. Si el usuario está registrado y MongoDB está activo, extraer señales de escucha reales
  if (userId && isMongoConnected()) {
    try {
      // Artistas más escuchados por el usuario
      const artistAgg = await ListenHistory.aggregate([
        { $match: { userId } },
        { $group: { _id: '$artist', count: { $sum: 1 }, lastPlayed: { $max: '$playedAt' }, thumbnail: { $first: '$thumbnail' } } },
        { $match: { _id: { $nin: ['Artista Desconocido', 'Desconocido', ''] } } },
        { $sort: { count: -1, lastPlayed: -1 } },
        { $limit: 6 }
      ]);

      topArtists = artistAgg.map((a) => ({
        name: a._id,
        count: a.count,
        thumbnail: a.thumbnail
      }));

      // Últimas canciones escuchadas (Historial)
      const recentDocs = await ListenHistory.find({ userId })
        .sort({ playedAt: -1 })
        .limit(20);

      const seenRecent = new Set();
      recentTracks = recentDocs
        .filter((t) => {
          if (seenRecent.has(t.trackId)) return false;
          seenRecent.add(t.trackId);
          return true;
        })
        .slice(0, 10)
        .map((t) => ({
          id: t.trackId,
          title: t.title,
          artist: t.artist,
          duration: t.duration,
          thumbnail: t.thumbnail,
          playedAt: t.playedAt
        }));

      // Canciones favoritas del usuario
      const likesDocs = await LikedTrack.find({ userId })
        .sort({ likedAt: -1 })
        .limit(15);

      likedTracks = likesDocs.map((l) => ({
        id: l.trackId,
        title: l.title,
        artist: l.artist,
        duration: l.duration,
        thumbnail: l.thumbnail
      }));
    } catch (err) {
      console.warn('[Recommendation Telemetry Warning]:', err.message);
    }
  }

  // 2. CASO PERSONALIZADO: Si el usuario tiene gustos identificados
  if (topArtists.length > 0 || likedTracks.length > 0) {
    const primaryArtist = topArtists[0]?.name || likedTracks[0]?.artist || 'Top Hits';
    const secondaryArtist = topArtists[1]?.name || null;

    try {
      // Ejecutar búsquedas diferenciadas en paralelo
      const [primarySongsRaw, secondarySongsRaw, newReleasesRaw, moodSongsRaw, similarDiscoveriesRaw] = await Promise.all([
        searchTracks(`${primaryArtist} mejores canciones audio oficial`),
        secondaryArtist ? searchTracks(`${secondaryArtist} mejores exitos`) : Promise.resolve([]),
        searchTracks('nuevos lanzamientos estrenos musicales 2026 oficial'),
        searchTracks(moodConfig.query),
        searchTracks(`canciones similares a ${primaryArtist} artistas afines radio`)
      ]);

      // A. HERO BANNER: Priorizar canción favorita o tema insigne del artista preferido
      let heroTrack = likedTracks[0] || primarySongsRaw[0];
      if (heroTrack) {
        seenTrackIds.add(heroTrack.id);
      }

      // B. SLIDE 1: MIX DIARIO / HECHO PARA TI
      // Inicia con favoritos del usuario + temas del artista principal y secundario
      const dailyCandidates = [];
      likedTracks.slice(0, 4).forEach((t) => dailyCandidates.push(t));
      primarySongsRaw.forEach((t) => dailyCandidates.push(t));
      secondarySongsRaw.forEach((t) => dailyCandidates.push(t));
      const dailyMix = collectUniqueTracks(dailyCandidates, seenTrackIds, 15);

      // C. SLIDE 2: NOVEDADES & ESTRENOS DE LA SEMANA
      const newReleases = collectUniqueTracks(newReleasesRaw, seenTrackIds, 15);

      // D. SLIDE 3: MOOD / AMBIENTE DEL MOMENTO (Dinámico por horario)
      const moodTracks = collectUniqueTracks(moodSongsRaw, seenTrackIds, 15);

      // E. SLIDE 4: DESCUBRIMIENTOS AFINES (Excluyendo al artista original para descubrir NUEVOS exponentes)
      let similarTracks = collectUniqueTracks(similarDiscoveriesRaw, seenTrackIds, 15, primaryArtist);
      // Si el filtro estricto dejó pocas pistas, permitir afines restantes asegurando unicidad
      if (similarTracks.length < 5) {
        const fallbackSimilar = collectUniqueTracks(similarDiscoveriesRaw, seenTrackIds, 15);
        similarTracks = [...similarTracks, ...fallbackSimilar].slice(0, 15);
      }

      const feedData = {
        isPersonalized: true,
        heroTrack: heroTrack || dailyMix[0] || null,
        dailyMix: dailyMix,
        newReleases: newReleases,
        moodMix: {
          title: moodConfig.title,
          subtitle: moodConfig.subtitle,
          icon: moodConfig.icon,
          badgeColor: moodConfig.badgeColor,
          tracks: moodTracks
        },
        becauseYouListened: {
          artist: primaryArtist,
          tracks: similarTracks
        },
        topArtists: topArtists,
        recentlyPlayed: recentTracks,
        timestamp: new Date().toISOString()
      };

      recommendationCache.set(cacheKey, { timestamp: Date.now(), data: feedData });
      return feedData;
    } catch (err) {
      console.error('[Recommendation Generation Error]:', err);
    }
  }

  // 3. CASO INVITADO / USUARIO NUEVO (Sin historial): Recomendaciones 100% ricas y sin repetir
  try {
    const [popHitsRaw, newReleasesRaw, moodSongsRaw, viralHitsRaw] = await Promise.all([
      getTrendingTracks('pop'),
      searchTracks('nuevos lanzamientos musicales estrenos 2026 oficial'),
      searchTracks(moodConfig.query),
      searchTracks('canciones virales mas escuchadas en redes 2026')
    ]);

    // A. HERO BANNER
    const heroTrack = popHitsRaw[0] || null;
    if (heroTrack) {
      seenTrackIds.add(heroTrack.id);
    }

    // B. SLIDE 1: MIX GLOBAL
    const dailyMix = collectUniqueTracks(popHitsRaw, seenTrackIds, 15);

    // C. SLIDE 2: NOVEDADES & ESTRENOS
    const newReleases = collectUniqueTracks(newReleasesRaw, seenTrackIds, 15);

    // D. SLIDE 3: MOOD DEL MOMENTO
    const moodTracks = collectUniqueTracks(moodSongsRaw, seenTrackIds, 15);

    // E. SLIDE 4: ÉXITOS VIRALES
    const viralTracks = collectUniqueTracks(viralHitsRaw, seenTrackIds, 15);

    const defaultArtists = [
      { name: 'The Weeknd', count: 1, thumbnail: popHitsRaw[0]?.thumbnail || '' },
      { name: 'Bad Bunny', count: 1, thumbnail: newReleasesRaw[0]?.thumbnail || '' },
      { name: 'Dua Lipa', count: 1, thumbnail: popHitsRaw[1]?.thumbnail || '' },
      { name: 'Coldplay', count: 1, thumbnail: moodSongsRaw[0]?.thumbnail || '' },
      { name: 'Daft Punk', count: 1, thumbnail: viralHitsRaw[0]?.thumbnail || '' },
      { name: 'Billie Eilish', count: 1, thumbnail: popHitsRaw[2]?.thumbnail || '' }
    ];

    const feedData = {
      isPersonalized: false,
      heroTrack: heroTrack || dailyMix[0] || null,
      dailyMix: dailyMix,
      newReleases: newReleases,
      moodMix: {
        title: moodConfig.title,
        subtitle: moodConfig.subtitle,
        icon: moodConfig.icon,
        badgeColor: moodConfig.badgeColor,
        tracks: moodTracks
      },
      becauseYouListened: {
        artist: 'Éxitos Virales en Tendencia',
        tracks: viralTracks
      },
      topArtists: defaultArtists,
      recentlyPlayed: [],
      timestamp: new Date().toISOString()
    };

    recommendationCache.set(cacheKey, { timestamp: Date.now(), data: feedData });
    return feedData;
  } catch (err) {
    console.error('[Default Recommendation Error]:', err);
    return {
      isPersonalized: false,
      heroTrack: null,
      dailyMix: [],
      newReleases: [],
      moodMix: null,
      becauseYouListened: null,
      topArtists: [],
      recentlyPlayed: []
    };
  }
}

