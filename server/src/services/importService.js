import youtubedl from 'youtube-dl-exec';

function formatSeconds(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function cleanTitleAndArtist(rawTitle, rawUploader) {
  let title = rawTitle || '';
  let artist = rawUploader || 'Desconocido';

  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    if (parts.length >= 2) {
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    }
  }

  // Limpiar sufijos típicos
  title = title
    .replace(/\(Official Music Video\)/gi, '')
    .replace(/\(Official Video\)/gi, '')
    .replace(/\(Video Oficial\)/gi, '')
    .replace(/\(Official Audio\)/gi, '')
    .replace(/\[Official Audio\]/gi, '')
    .replace(/\[Visualizer\]/gi, '')
    .replace(/\(Visualizer\)/gi, '')
    .replace(/\[HD\]/gi, '')
    .replace(/\(Lyric Video\)/gi, '')
    .replace(/\(Letra\)/gi, '')
    .replace(/\[4K Remaster\]/gi, '')
    .replace(/\(4K Remaster\)/gi, '')
    .trim();

  return { title, artist };
}

export function classifyTrackAsMusic({ title, originalTitle, artist, durationSec, categories }) {
  const t = (originalTitle || title || '').toLowerCase();
  const a = (artist || '').toLowerCase();
  const dur = Number(durationSec) || 0;

  // 1. Descartar extremos de duración (menos de 45s es meme/short, más de 20 min es podcast/gameplay)
  if (dur > 0 && (dur < 45 || dur > 1200)) {
    return { isMusic: false, reason: dur < 45 ? 'Demasiado corto (<45s)' : 'Demasiado largo (>20m)' };
  }

  // 2. Anti-patrones explícitos en el título (no música)
  const antiPatterns = /\b(gameplay|walkthrough|tutorial|unboxing|podcast|episode|episodio|vlog|noticias|news|reacción|reaction|review|highlights|directo|resumen|parche|patch|guía|guide|clase|conferencia)\b/i;
  if (antiPatterns.test(t)) {
    return { isMusic: false, reason: 'Contenido no musical detectado' };
  }

  // 3. Indicadores claros de música en canal o título
  const isOfficialTopic = a.endsWith('- topic') || a.endsWith('topic');
  const hasMusicKeywords = /\b(official video|official audio|lyrics|letra|remix|feat\.|ft\.|prod\.|visualizer|music video|videoclip|canción|soundtrack|ost)\b/i.test(t);
  const isMusicChannel = /\b(vevo|records|music|discográfica|audio|sound)\b/i.test(a);
  const isMusicCategory = Array.isArray(categories) && categories.some((c) => /music|música/i.test(c));

  if (isOfficialTopic || hasMusicKeywords || isMusicChannel || isMusicCategory) {
    return { isMusic: true, reason: 'Identificado como música' };
  }

  // Por defecto si la duración es típica de una canción (entre 1m y 7m)
  if (dur >= 60 && dur <= 420) {
    return { isMusic: true, reason: 'Duración estándar de pista' };
  }

  return { isMusic: true, reason: 'Aceptado' };
}

function isValidYouTubeInput(input) {
  if (!input || typeof input !== 'string') return false;
  const trimmed = input.trim();
  if (trimmed.startsWith('-')) return false; // Bloquear CLI flag injection

  // Si es un ID de video o playlist directo
  if (/^[a-zA-Z0-9_-]{11,34}$/.test(trimmed)) return true;

  try {
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const hostname = url.hostname.toLowerCase();
    const validHosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];
    return validHosts.includes(hostname) || hostname.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

export async function importFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('Debes proporcionar un enlace o ID de YouTube válido.');
  }

  const input = rawUrl.trim();
  if (!isValidYouTubeInput(input)) {
    throw new Error('El enlace proporcionado no es un dominio o ID de YouTube válido.');
  }

  // Detectar si es un enlace de playlist
  const isPlaylist =
    input.includes('list=') ||
    input.includes('/playlist') ||
    input.includes('&list=');

  if (isPlaylist) {
    try {
      const plData = await youtubedl(input, {
        dumpSingleJson: true,
        flatPlaylist: true,
        noWarnings: true,
        noCheckCertificate: true
      });

      if (!plData || !plData.entries || plData.entries.length === 0) {
        throw new Error('No se encontraron canciones en esta lista de reproducción.');
      }

      const tracks = plData.entries
        .filter((e) => e && (e.id || e.url))
        .map((entry) => {
          const videoId = entry.id;
          const { title, artist } = cleanTitleAndArtist(entry.title, entry.uploader);
          const durationSec = entry.duration || 0;
          const classification = classifyTrackAsMusic({
            title,
            originalTitle: entry.title,
            artist,
            durationSec,
            categories: entry.categories
          });

          return {
            id: videoId,
            title: title || entry.title,
            originalTitle: entry.title,
            artist: artist || 'Desconocido',
            duration: formatSeconds(durationSec),
            seconds: durationSec,
            isMusic: classification.isMusic,
            filterReason: classification.reason,
            thumbnail:
              entry.thumbnails?.[0]?.url ||
              `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            url: `https://www.youtube.com/watch?v=${videoId}`
          };
        });

      const musicTracks = tracks.filter((t) => t.isMusic);

      return {
        type: 'playlist',
        title: plData.title || 'Playlist Importada',
        trackCount: tracks.length,
        musicCount: musicTracks.length,
        filteredCount: tracks.length - musicTracks.length,
        tracks
      };
    } catch (err) {
      console.error('[Import Playlist Error]:', err.message);
      throw new Error(`Error al importar playlist: ${err.message}`);
    }
  }

  // Si es un video individual o enlace corto
  try {
    const videoData = await youtubedl(input, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificate: true
    });

    if (!videoData || !videoData.id) {
      throw new Error('No se pudo obtener información del video.');
    }

    const { title, artist } = cleanTitleAndArtist(videoData.title, videoData.uploader);
    const durationSec = videoData.duration || 0;

    const track = {
      id: videoData.id,
      title: title || videoData.title,
      originalTitle: videoData.title,
      artist: artist || 'Desconocido',
      duration: formatSeconds(durationSec),
      seconds: durationSec,
      thumbnail:
        videoData.thumbnail ||
        `https://i.ytimg.com/vi/${videoData.id}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoData.id}`
    };

    return {
      type: 'track',
      track
    };
  } catch (err) {
    console.error('[Import Video Error]:', err.message);
    throw new Error(`Error al importar canción: ${err.message}`);
  }
}
