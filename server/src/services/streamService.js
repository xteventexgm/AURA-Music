import youtubedl from 'youtube-dl-exec';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const downloadsDir = path.resolve(__dirname, '../../downloads');

// Caché en memoria para URLs resueltas (TTL: 2 horas)
const urlCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

// Lista de instancias públicas resilientes para streaming en la nube cuando YouTube bloquea IPs de datacenters
const INVIDIOUS_INSTANCES = [
  'https://invidious.f5.si',
  'https://yt.chocolatemoo53.com',
  'https://inv.nadeko.net'
];

async function resolveFromInvidious(videoId) {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${base}/api/v1/videos/${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        const audioFormats = (data.adaptiveFormats || []).filter(
          (f) => (f.type && f.type.startsWith('audio')) || (f.mime && f.mime.startsWith('audio'))
        );
        if (audioFormats.length > 0) {
          audioFormats.sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
          const best = audioFormats[0];
          return {
            url: best.url,
            title: data.title || videoId,
            ext: 'm4a',
            duration: data.lengthSeconds || null,
            proxy: null,
            timestamp: Date.now()
          };
        }
      }
    } catch {}
  }
  return null;
}

// Lista de proxies rotativos de Webshare para bypass anti-bot y enlace IP en la nube
const WEBSHARE_PROXIES = [
  'http://xteventexgm:xteventex777@23.26.71.145:5628',
  'http://xteventexgm:xteventex777@64.137.10.153:5803',
  'http://xteventexgm:xteventex777@198.46.161.42:5092',
  'http://xteventexgm:xteventex777@104.164.49.38:7693',
  'http://xteventexgm:xteventex777@45.38.107.97:6014',
  'http://xteventexgm:xteventex777@64.137.96.74:6641',
  'http://xteventexgm:xteventex777@198.23.243.226:6361',
  'http://xteventexgm:xteventex777@38.154.185.97:6370',
  'http://xteventexgm:xteventex777@84.247.60.125:6095',
  'http://xteventexgm:xteventex777@191.96.254.138:6185'
];

let proxyIndex = 0;

function getProxyList() {
  const envProxy = process.env.PROXY_URL || process.env.WEBSHARE_PROXY;
  if (envProxy && envProxy.trim()) {
    return [envProxy.trim(), ...WEBSHARE_PROXIES];
  }
  return WEBSHARE_PROXIES;
}

// Helper para realizar peticiones HTTP respetando la IP asignada por Google Video
async function fetchRemoteStream(url, proxy, headers) {
  const opts = { headers };
  if (proxy) {
    opts.dispatcher = new ProxyAgent(proxy);
  }
  return await undiciFetch(url, opts);
}

export async function resolveStreamInfo(videoId) {
  const cached = urlCache.get(videoId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached;
  }

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const proxies = getProxyList();

  // 1. Intentar con yt-dlp usando la lista completa de proxies de Webshare
  for (let i = 0; i < proxies.length; i++) {
    const activeProxy = proxies[(proxyIndex + i) % proxies.length];
    try {
      const ytOptions = {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificate: true,
        format: 'ba/b',
        proxy: activeProxy,
        extractorArgs: 'youtube:player_client=android;player_skip=webpage,configs'
      };

      console.log(`[yt-dlp ${videoId}]: Conectando mediante proxy ${activeProxy.split('@')[1] || 'Webshare'}...`);
      const info = await youtubedl(youtubeUrl, ytOptions);
      if (info && info.url) {
        const record = {
          url: info.url,
          title: info.title || videoId,
          ext: info.ext || 'm4a',
          duration: info.duration || null,
          proxy: activeProxy,
          timestamp: Date.now()
        };
        urlCache.set(videoId, record);
        proxyIndex = (proxyIndex + i) % proxies.length;
        console.log(`[yt-dlp ${videoId}]: Stream resuelto con éxito mediante proxy ${activeProxy.split('@')[1]}.`);
        return record;
      }
    } catch (err) {
      console.warn(`[yt-dlp Proxy Warning ${videoId}]:`, err.message?.slice(0, 160));
    }
  }

  // 2. Si fallan los proxies, intentar conexión directa (ideal para PC / conexión residencial local)
  try {
    const directOptions = {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificate: true,
      format: 'ba/b',
      extractorArgs: 'youtube:player_client=android;player_skip=webpage,configs'
    };
    const info = await youtubedl(youtubeUrl, directOptions);
    if (info && info.url) {
      const record = {
        url: info.url,
        title: info.title || videoId,
        ext: info.ext || 'm4a',
        duration: info.duration || null,
        proxy: null,
        timestamp: Date.now()
      };
      urlCache.set(videoId, record);
      return record;
    }
  } catch (err) {
    console.warn(`[yt-dlp Direct Warning ${videoId}]:`, err.message?.slice(0, 160));
  }

  // 3. Fallback de alta resiliencia para servidores en la nube (Invidious)
  console.log(`[Stream Fallback ${videoId}]: Resolviendo mediante red distribuida...`);
  const fallbackRecord = await resolveFromInvidious(videoId);
  if (fallbackRecord && fallbackRecord.url) {
    urlCache.set(videoId, fallbackRecord);
    return fallbackRecord;
  }

  throw new Error('No se pudo resolver el stream de audio mediante ningún proveedor');
}

export async function resolveStreamUrl(videoId) {
  const info = await resolveStreamInfo(videoId);
  return info.url;
}

// Proxy de streaming con soporte total para HTTP 206 Range (Seeking / Scrubber)
export async function handleStreamRequest(req, res, videoId) {
  try {
    let info = await resolveStreamInfo(videoId);
    const range = req.headers.range;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };

    if (range) {
      headers['Range'] = range;
    }

    let audioResponse = await fetchRemoteStream(info.url, info.proxy, headers);

    // Si Google Video devuelve 403 o error, el token de IP expiró o requiere rotación
    if (!audioResponse.ok && audioResponse.status !== 206) {
      console.warn(`[Stream ${videoId}]: Origen devolvió HTTP ${audioResponse.status}. Invalidando caché y rotando proxy...`);
      urlCache.delete(videoId);
      proxyIndex = (proxyIndex + 1) % WEBSHARE_PROXIES.length;
      info = await resolveStreamInfo(videoId);
      audioResponse = await fetchRemoteStream(info.url, info.proxy, headers);
    }

    if (!audioResponse.ok && audioResponse.status !== 206) {
      console.error(`[Stream ${videoId}]: Error persistente en audio remoto: HTTP ${audioResponse.status}`);
      if (!res.headersSent) {
        return res.status(502).json({ error: 'Error del servidor de audio remoto', status: audioResponse.status });
      }
      return;
    }

    return pipeResponse(audioResponse, res, range);
  } catch (err) {
    console.error(`[Stream Error ${videoId}]:`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al transmitir audio', details: err.message });
    }
  }
}

// Transmisión directa de alta velocidad para descargas cliente (0 escrituras en disco del servidor)
export async function handleStreamDownload(req, res, videoId, customTitle = '') {
  try {
    const cleanTitle = (customTitle || videoId)
      .replace(/[\\/:*?"<>|\r\n\t]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);

    const filename = `${cleanTitle || videoId}.m4a`;

    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const info = await resolveStreamInfo(videoId);
    const audioRes = await fetchRemoteStream(info.url, info.proxy, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    if (!audioRes.ok) {
      throw new Error(`HTTP ${audioRes.status} al descargar audio remoto`);
    }

    if (audioRes.body) {
      const reader = audioRes.body.getReader();
      let isClosed = false;
      res.on('close', () => {
        isClosed = true;
        try { reader.cancel(); } catch {}
      });

      while (!isClosed) {
        const { done, value } = await reader.read();
        if (done || isClosed) break;
        res.write(value);
      }
      if (!isClosed) res.end();
    } else {
      res.end();
    }
  } catch (err) {
    console.error(`[Download Stream Exception ${videoId}]:`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error en descarga directa', details: err.message });
    }
  }
}

function pipeResponse(remoteRes, clientRes, range) {
  const contentType = remoteRes.headers.get('content-type') || 'audio/mp4';
  const contentLength = remoteRes.headers.get('content-length');
  const contentRange = remoteRes.headers.get('content-range');
  const acceptRanges = remoteRes.headers.get('accept-ranges') || 'bytes';

  const resHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': acceptRanges,
    'Cache-Control': 'public, max-age=3600'
  };

  if (contentRange) {
    resHeaders['Content-Range'] = contentRange;
    clientRes.writeHead(206, resHeaders);
  } else {
    if (contentLength) resHeaders['Content-Length'] = contentLength;
    clientRes.writeHead(remoteRes.status, resHeaders);
  }

  if (remoteRes.body) {
    const reader = remoteRes.body.getReader();
    let isClosed = false;
    clientRes.on('close', () => {
      isClosed = true;
      try { reader.cancel(); } catch {}
    });

    async function pump() {
      try {
        while (!isClosed) {
          const { done, value } = await reader.read();
          if (done || isClosed) break;
          clientRes.write(value);
        }
        if (!isClosed) clientRes.end();
      } catch (streamErr) {
        if (!isClosed) clientRes.end();
      }
    }
    pump();
  } else {
    clientRes.end();
  }
}

// Helpers para compatibilidad hacia atrás (Servidor 100% Stateless sin almacenamiento en disco)
export async function downloadTrack(videoId, title) {
  const cleanTitle = (title || videoId)
    .replace(/[\\/:*?"<>|\r\n\t]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);

  return {
    filename: `${cleanTitle}.m4a`,
    audioDownloadUrl: `/api/stream/download/${videoId}?title=${encodeURIComponent(cleanTitle)}`,
    isStateless: true
  };
}

export function getDownloadedTracks() {
  return [];
}

export function deleteDownloadedTrack() {
  return true;
}

export function getStorageStats() {
  return {
    isNative: false,
    path: 'Servidor Stateless (100% en la Nube - 0 descargas en disco)',
    totalFiles: 0,
    totalBytes: 0,
    totalMb: '0.00'
  };
}

export function pruneOldDownloads() {
  return { pruned: 0, freedMb: '0.00' };
}

export { downloadsDir };
