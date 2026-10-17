// Servicio de letras sincronizadas y regulares vía LRCLIB (gratuito, sin cuotas)

export async function getLyrics(artist, track, duration) {
  if (!track) return null;

  try {
    const cleanTrack = track
      .replace(/\(feat\..*?\)/gi, '')
      .replace(/\[feat\..*?\]/gi, '')
      .replace(/ft\..*?$/gi, '')
      .trim();

    const cleanArtist = (artist || '').trim();

    let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTrack)}`;
    if (cleanArtist && cleanArtist !== 'Desconocido') {
      url += `&artist_name=${encodeURIComponent(cleanArtist)}`;
    }
    if (duration && typeof duration === 'number') {
      url += `&duration=${Math.round(duration)}`;
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'ReproductorPro/1.0.0 (https://github.com/myplayer)'
      }
    });

    if (res.ok) {
      const data = await res.json();
      return parseLyricsPayload(data);
    }

    // Búsqueda de respaldo si la coincidencia exacta falló
    const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanArtist} ${cleanTrack}`.trim())}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'ReproductorPro/1.0.0 (https://github.com/myplayer)'
      }
    });

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (Array.isArray(searchData) && searchData.length > 0) {
        return parseLyricsPayload(searchData[0]);
      }
    }

    return null;
  } catch (err) {
    console.error('[LyricsService Error]:', err.message);
    return null;
  }
}

function parseLyricsPayload(data) {
  const syncedLines = [];

  if (data.syncedLyrics) {
    const rawLines = data.syncedLyrics.split('\n');
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

    for (const line of rawLines) {
      const match = line.match(timeRegex);
      if (match) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const millis = parseInt(match[3].padEnd(3, '0').slice(0, 3), 10);
        const timeInSeconds = minutes * 60 + seconds + millis / 1000;
        const text = match[4].trim();

        if (text) {
          syncedLines.push({
            time: timeInSeconds,
            text: text
          });
        }
      }
    }
  }

  return {
    trackName: data.trackName,
    artistName: data.artistName,
    hasSynced: syncedLines.length > 0,
    synced: syncedLines,
    plain: data.plainLyrics || null
  };
}
