/**
 * AURA Music - Gestión de Almacenamiento Local (LocalStorage y Backup/Restore)
 */

const STORAGE_KEY = 'aura_music_data';

const DEFAULT_STATE = {
  playlists: {
    Favoritas: []
  },
  ultimaCola: [],
  ultimoIndice: 0,
  ultimoModoAleatorio: false,
  busquedasRecientes: [],
  ultimoPool: [],
  ultimoCursor: 0,
  volumen: 1.0,
  descargasLocales: []
};

export function loadStoredData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        playlists: data.playlists || { Favoritas: [] },
        ultimaCola: Array.isArray(data.ultimaCola) ? data.ultimaCola : [],
        ultimoIndice: typeof data.ultimoIndice === 'number' ? data.ultimoIndice : 0,
        ultimoModoAleatorio: Boolean(data.ultimoModoAleatorio),
        busquedasRecientes: Array.isArray(data.busquedasRecientes) ? data.busquedasRecientes : [],
        ultimoPool: Array.isArray(data.ultimoPool) ? data.ultimoPool : [],
        ultimoCursor: typeof data.ultimoCursor === 'number' ? data.ultimoCursor : 0,
        volumen: typeof data.volumen === 'number' ? data.volumen : 1.0,
        descargasLocales: Array.isArray(data.descargasLocales) ? data.descargasLocales : []
      };
    }

    // Compatibilidad retroactiva: si existe data vieja del reproductor anterior en localStorage
    const oldRaw = localStorage.getItem('misDatosReproductor');
    if (oldRaw) {
      const oldData = JSON.parse(oldRaw);
      return {
        ...DEFAULT_STATE,
        playlists: oldData.playlists || { Favoritas: [] },
        busquedasRecientes: oldData.busquedasRecientes || []
      };
    }
  } catch (err) {
    console.error('[Storage] Error cargando datos guardados:', err);
  }
  return { ...DEFAULT_STATE };
}

export function saveStoredData(data) {
  try {
    const current = loadStoredData();
    const updated = { ...current, ...data };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('[Storage] Error guardando datos:', err);
  }
}

/**
 * Exporta un archivo JSON de respaldo para que el usuario guarde sus playlists
 */
export function exportBackupFile() {
  try {
    const data = loadStoredData();
    const exportPayload = {
      app: 'AURA Music',
      version: '1.0.0',
      exportDate: new Date().toISOString(),
      playlists: data.playlists,
      busquedasRecientes: data.busquedasRecientes
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aura_playlists_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('[Storage] Error exportando respaldo:', err);
    return false;
  }
}

/**
 * Importa y fusiona un archivo JSON de respaldo (compatible con AURA y con el formato del MVP anterior)
 */
export function importBackupJson(jsonString, modo = 'fusionar') {
  try {
    const parsed = JSON.parse(jsonString);
    let incomingPlaylists = null;

    if (parsed.playlists && typeof parsed.playlists === 'object') {
      incomingPlaylists = parsed.playlists;
    } else if (parsed && typeof parsed === 'object' && !parsed.playlists) {
      // Por si el usuario subió un objeto { Favoritas: [...] } directo
      incomingPlaylists = parsed;
    }

    if (!incomingPlaylists) {
      throw new Error('El archivo no contiene un formato de playlists válido.');
    }

    const current = loadStoredData();

    if (modo === 'reemplazar') {
      current.playlists = incomingPlaylists;
    } else {
      // Modo fusión: no pisamos playlists existentes, añadimos o combinamos canciones
      for (const [plName, tracks] of Object.entries(incomingPlaylists)) {
        if (!Array.isArray(tracks)) continue;

        if (!current.playlists[plName]) {
          current.playlists[plName] = [...tracks];
        } else {
          // Fusionar sin duplicados por urlYoutube o titulo
          const existingMap = new Set(
            current.playlists[plName].map((t) => (t.urlYoutube || t.titulo || '').toLowerCase())
          );
          tracks.forEach((track) => {
            const key = (track.urlYoutube || track.titulo || '').toLowerCase();
            if (!existingMap.has(key)) {
              current.playlists[plName].push(track);
              existingMap.add(key);
            }
          });
        }
      }
    }

    saveStoredData({ playlists: current.playlists });
    return { success: true, count: Object.keys(current.playlists).length };
  } catch (err) {
    console.error('[Storage] Error importando respaldo:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Gestión de canciones descargadas offline
 */
export function getDownloadedTracks() {
  return loadStoredData().descargasLocales || [];
}

export function isTrackDownloaded(track) {
  if (!track) return false;
  const downloads = getDownloadedTracks();
  const id = track.id || track.videoId || '';
  const url = (track.urlYoutube || track.url || '').toLowerCase();
  const title = (track.titulo || track.title || '').toLowerCase();

  return downloads.some((d) => {
    if (id && (d.id === id || d.videoId === id)) return true;
    if (url && (d.urlYoutube || d.url || '').toLowerCase() === url) return true;
    if (title && (d.titulo || d.title || '').toLowerCase() === title) return true;
    return false;
  });
}

export function registerDownloadedTrack(track, filePath, localUrl = null) {
  if (!track) return;
  const current = loadStoredData();
  const downloads = current.descargasLocales || [];
  const rawTitle = track.titulo || track.title || 'Pista';
  const entry = {
    ...track,
    titulo: rawTitle,
    title: rawTitle,
    channel: track.channel || 'AURA Offline',
    path: filePath,
    localUrl: localUrl || filePath,
    downloadDate: new Date().toISOString()
  };
  const key = (track.urlYoutube || track.url || rawTitle).toLowerCase();
  const filtered = downloads.filter((d) => (d.urlYoutube || d.url || d.titulo || d.title || '').toLowerCase() !== key);
  filtered.unshift(entry);
  saveStoredData({ descargasLocales: filtered });
}

export function unregisterDownloadedTrack(track) {
  if (!track) return;
  const current = loadStoredData();
  const downloads = current.descargasLocales || [];
  const id = track.id || track.videoId || '';
  const url = (track.urlYoutube || track.url || '').toLowerCase();
  const title = (track.titulo || track.title || '').toLowerCase();

  const filtered = downloads.filter((d) => {
    if (id && (d.id === id || d.videoId === id)) return false;
    if (url && (d.urlYoutube || d.url || '').toLowerCase() === url) return false;
    if (title && (d.titulo || d.title || '').toLowerCase() === title) return false;
    return true;
  });
  saveStoredData({ descargasLocales: filtered });
}

export function getDownloadedTrackInfo(track) {
  if (!track) return null;
  const downloads = getDownloadedTracks();
  const id = track.id || track.videoId || '';
  const url = (track.urlYoutube || track.url || '').toLowerCase();
  const title = (track.titulo || track.title || '').toLowerCase();

  return (
    downloads.find((d) => {
      if (id && (d.id === id || d.videoId === id)) return true;
      if (url && (d.urlYoutube || d.url || '').toLowerCase() === url) return true;
      if (title && (d.titulo || d.title || '').toLowerCase() === title) return true;
      return false;
    }) || null
  );
}
