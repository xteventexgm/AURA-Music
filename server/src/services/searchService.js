import ytSearch from 'yt-search';

// Búsqueda inteligente con formateo de resultados de alta fidelidad
export async function searchTracks(query) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return [];
  }

  try {
    const results = await ytSearch(query.trim());
    const videos = results.videos || [];

    return videos.slice(0, 30).map((v) => {
      // Extraer artista del título si está formateado como "Artista - Canción"
      let artist = v.author?.name || 'Desconocido';
      let title = v.title || '';

      if (title.includes(' - ')) {
        const parts = title.split(' - ');
        if (parts.length >= 2) {
          artist = parts[0].trim();
          title = parts.slice(1).join(' - ').trim();
        }
      }

      // Limpiar sufijos típicos molestos de YouTube
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
        .trim();

      return {
        id: v.videoId,
        title: title || v.title,
        originalTitle: v.title,
        artist: artist,
        duration: v.timestamp || '0:00',
        seconds: v.seconds || 0,
        thumbnail: v.image || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        views: v.views || 0,
        ago: v.ago || '',
        url: v.url
      };
    });
  } catch (error) {
    console.error('[SearchService Error]:', error);
    return [];
  }
}

// Obtener música en tendencia para la pantalla de inicio
export async function getTrendingTracks(category = 'pop') {
  const queries = {
    pop: 'Top hits 2026 pop music',
    latin: 'Top exitos reggaeton latino',
    rock: 'Rock classics hits',
    electronic: 'EDM festival hits',
    chill: 'Lo-Fi Chill beats study',
    gaming: 'Synthwave gaming hits'
  };

  const selectedQuery = queries[category] || queries.pop;
  return searchTracks(selectedQuery);
}
