/**
 * AURA Music - Servicios de API (Búsqueda y Extracción de Audio)
 */

import {
  getYoutubeApiKey,
  getActiveRapidKey,
  rotateRapidKey,
  getRapidApiKeys,
  RAPID_API_HOST
} from './config.js';

/**
 * Convierte formatos ISO 8601 de YouTube (ej. PT4M20S) a mm:ss o hh:mm:ss
 */
export function convertirDuracionYouTube(isoDuration) {
  if (!isoDuration || isoDuration === 'P0D') return 'En vivo';
  const match = isoDuration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
  if (!match) return '0:00';
  const horas = parseInt(match[1]) || 0;
  const minutos = parseInt(match[2]) || 0;
  const segundos = parseInt(match[3]) || 0;
  if (horas > 0) {
    return `${horas}:${minutos.toString().padStart(2, '0')}:${segundos.toString().padStart(2, '0')}`;
  }
  return `${minutos}:${segundos.toString().padStart(2, '0')}`;
}

/**
 * Convierte duración mm:ss a segundos numéricos
 */
export function duracionASegundos(str) {
  if (!str) return 0;
  const partes = str.split(':').map(Number);
  if (partes.length === 2) return partes[0] * 60 + partes[1];
  if (partes.length === 3) return partes[0] * 3600 + partes[1] * 60 + partes[2];
  return 0;
}

/**
 * Formatea segundos totales a formato legible (ej: 1 h 25 min o 3:45)
 */
export function formatearTiempoTotal(segundos) {
  const hrs = Math.floor(segundos / 3600);
  const mins = Math.floor((segundos % 3600) / 60);
  const secs = segundos % 60;
  if (hrs > 0) return `${hrs} h ${mins} min`;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * Extrae el video ID de cualquier enlace estándar de YouTube
 */
export function extraerVideoId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.slice(1).split('?')[0];
    }
    return u.searchParams.get('v');
  } catch {
    // Si pasaron solo el ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(url.trim())) {
      return url.trim();
    }
    return null;
  }
}

/**
 * Extrae el playlist ID de un enlace de YouTube
 */
export function extraerPlaylistId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.searchParams.get('list');
  } catch {
    return null;
  }
}

/**
 * Búsqueda de pistas en YouTube mediante Data API v3
 */
export async function buscarMusica(query) {
  const key = getYoutubeApiKey();
  if (!key) throw new Error('No hay llave de YouTube configurada.');

  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=30&q=${encodeURIComponent(
    query
  )}&type=video&key=${key}`;

  const res = await fetch(searchUrl);
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error('Cuota de YouTube agotada (403). Configura una nueva llave en Ajustes.');
    }
    throw new Error(`Error en búsqueda (${res.status})`);
  }

  const data = await res.json();
  if (!data.items || data.items.length === 0) return [];

  // Obtener duraciones en lote para no hacer peticiones individuales
  const videoIds = data.items.map((item) => item.id.videoId).filter(Boolean).join(',');
  const mapaDuraciones = {};

  if (videoIds) {
    try {
      const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${key}`;
      const detRes = await fetch(detailsUrl);
      if (detRes.ok) {
        const detData = await detRes.json();
        (detData.items || []).forEach((v) => {
          mapaDuraciones[v.id] = convertirDuracionYouTube(v.contentDetails.duration);
        });
      }
    } catch (e) {
      console.warn('[API] No se pudieron obtener duraciones en lote:', e);
    }
  }

  const isSearchForShorts = /#?shorts?|\breels?\b/i.test(query);
  const tracks = [];

  for (const item of data.items) {
    if (!item.id?.videoId) continue;
    const vId = item.id.videoId;
    const title = item.snippet.title
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
    const duration = mapaDuraciones[vId] || '0:00';
    const durationSec = duracionASegundos(duration);

    // Filtrar Reels y Shorts a menos que se hayan buscado intencionalmente
    if (!isSearchForShorts) {
      const hasShortTag = /#shorts?|\bshorts?\b|\breels?\b/i.test(title);
      // Videos de 60 segundos o menos suelen ser Shorts/Reels verticales
      if (hasShortTag || (durationSec > 0 && durationSec <= 60)) {
        continue;
      }
    }

    const fullUrl = `https://youtube.com/watch?v=${vId}`;
    const thumb =
      item.snippet.thumbnails.high?.url ||
      item.snippet.thumbnails.medium?.url ||
      item.snippet.thumbnails.default?.url;

    tracks.push({
      id: vId,
      title: title,
      titulo: title,
      channel: item.snippet.channelTitle,
      duration: duration,
      duracion: duration,
      url: fullUrl,
      urlYoutube: fullUrl,
      thumbnail: thumb
    });
  }

  return tracks;
}

/**
 * Extracción del enlace directo de audio usando el pool de llaves RapidAPI con rotación automática
 */
export async function obtenerEnlaceAudio(urlYoutube) {
  const videoId = extraerVideoId(urlYoutube);
  if (!videoId) throw new Error('URL de YouTube no válida');

  const keys = getRapidApiKeys();
  if (keys.length === 0) {
    throw new Error('No hay llaves de RapidAPI disponibles para streaming.');
  }

  const totalKeys = keys.length;

  for (let intento = 0; intento < totalKeys; intento++) {
    const activeKey = getActiveRapidKey();

    try {
      const fetchAudio = async () => {
        const res = await fetch(`https://${RAPID_API_HOST}/dl?id=${videoId}`, {
          method: 'GET',
          headers: {
            'x-rapidapi-key': activeKey,
            'x-rapidapi-host': RAPID_API_HOST
          }
        });

        if (res.status === 429 || res.status === 403) {
          console.warn(`[RapidAPI] Llave agotada (HTTP ${res.status}). Rotando a la siguiente...`);
          rotateRapidKey();
          return null;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        return await res.json();
      };

      let data = await fetchAudio();
      if (!data) continue; // Rotó llave por 429/403

      // Si la API está procesando la conversión, esperar un breve instante
      if (data.msg === 'in progress' || (data.status === 'processing' && !data.link)) {
        await new Promise((r) => setTimeout(r, 1500));
        data = await fetchAudio();
        if (!data) continue;
      }

      const streamUrl = data.link || data.url || (data.data ? data.data.url : null);

      if (streamUrl) {
        return streamUrl;
      }
      throw new Error('La API respondió sin enlace de audio');
    } catch (err) {
      console.warn(`[RapidAPI Intento ${intento + 1}/${totalKeys}]:`, err.message);
      rotateRapidKey();
    }
  }

  throw new Error('Todas las llaves de RapidAPI se han agotado o están fallando temporalmente.');
}

/**
 * Obtener detalles completos de un video por ID
 */
export async function obtenerDetallesVideo(videoId) {
  const key = getYoutubeApiKey();
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.items || data.items.length === 0) return null;

  const v = data.items[0];
  return {
    id: v.id,
    title: v.snippet.title.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
    channel: v.snippet.channelTitle,
    duration: convertirDuracionYouTube(v.contentDetails.duration),
    url: `https://youtube.com/watch?v=${v.id}`,
    thumbnail: v.snippet.thumbnails.high?.url || v.snippet.thumbnails.default?.url
  };
}

/**
 * Obtener pistas de una playlist de YouTube
 */
export async function obtenerVideosDePlaylist(playlistId) {
  const key = getYoutubeApiKey();
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${playlistId}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('No se pudo leer la playlist de YouTube');
  const data = await res.json();

  if (!data.items || data.items.length === 0) return [];

  const videoIds = data.items.map((i) => i.contentDetails.videoId).filter(Boolean).join(',');
  const mapaDuraciones = {};

  if (videoIds) {
    try {
      const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${key}`;
      const detRes = await fetch(detailsUrl);
      if (detRes.ok) {
        const detData = await detRes.json();
        (detData.items || []).forEach((v) => {
          mapaDuraciones[v.id] = convertirDuracionYouTube(v.contentDetails.duration);
        });
      }
    } catch {}
  }

  return data.items
    .filter((item) => item.contentDetails?.videoId)
    .map((item) => {
      const vId = item.contentDetails.videoId;
      return {
        tipo: 'online',
        titulo: item.snippet.title.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
        urlYoutube: `https://youtube.com/watch?v=${vId}`,
        thumbnail:
          item.snippet.thumbnails.high?.url ||
          item.snippet.thumbnails.medium?.url ||
          item.snippet.thumbnails.default?.url,
        duracion: mapaDuraciones[vId] || '0:00'
      };
    });
}

/**
 * Obtener el nombre oficial de una playlist de YouTube
 */
export async function obtenerNombrePlaylist(playlistId) {
  try {
    const key = getYoutubeApiKey();
    const url = `https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${playlistId}&key=${key}`;
    const res = await fetch(url);
    if (!res.ok) return 'Mix Importado';
    const data = await res.json();
    return data.items?.[0]?.snippet?.title || 'Mix Importado';
  } catch {
    return 'Mix Importado';
  }
}
