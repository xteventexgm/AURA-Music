/**
 * AURA Music - Gestor de Playlists
 */

import { loadStoredData, saveStoredData } from './storage.js';
import { duracionASegundos, formatearTiempoTotal } from './api.js';

class PlaylistManager {
  constructor() {
    this.playlists = {
      Favoritas: []
    };
    this.init();
  }

  init() {
    const data = loadStoredData();
    if (data.playlists && typeof data.playlists === 'object') {
      this.playlists = data.playlists;
      if (!this.playlists.Favoritas) {
        this.playlists.Favoritas = [];
      }
    }
  }

  save() {
    saveStoredData({ playlists: this.playlists });
  }

  getPlaylists() {
    return this.playlists;
  }

  getPlaylistNames() {
    return Object.keys(this.playlists);
  }

  getTracks(name) {
    return this.playlists[name] || [];
  }

  createPlaylist(name) {
    const cleanName = (name || '').trim();
    if (!cleanName) return { success: false, message: 'El nombre no puede estar vacío.' };
    if (this.playlists[cleanName]) {
      return { success: false, message: 'Ya existe una playlist con ese nombre.' };
    }

    this.playlists[cleanName] = [];
    this.save();
    return { success: true, name: cleanName };
  }

  deletePlaylist(name) {
    if (name === 'Favoritas') {
      return { success: false, message: 'No se puede eliminar la playlist Favoritas.' };
    }
    if (!this.playlists[name]) {
      return { success: false, message: 'Playlist no encontrada.' };
    }

    delete this.playlists[name];
    this.save();
    return { success: true };
  }

  renamePlaylist(oldName, newName) {
    const cleanNew = (newName || '').trim();
    if (oldName === 'Favoritas') {
      return { success: false, message: 'No se puede renombrar la playlist Favoritas.' };
    }
    if (!cleanNew) return { success: false, message: 'El nuevo nombre no es válido.' };
    if (this.playlists[cleanNew]) {
      return { success: false, message: 'Ya existe una playlist con ese nombre.' };
    }

    this.playlists[cleanNew] = this.playlists[oldName];
    delete this.playlists[oldName];
    this.save();
    return { success: true, name: cleanNew };
  }

  addTrack(playlistName, track) {
    if (!this.playlists[playlistName]) {
      return { success: false, message: 'Playlist no encontrada.' };
    }

    // Normalizar objeto de canción
    const cleanTrack = {
      tipo: 'online',
      titulo: track.titulo || track.title || 'Pista sin título',
      urlYoutube: track.urlYoutube || track.url || '',
      thumbnail: track.thumbnail || '',
      duracion: track.duracion || track.duration || '0:00',
      channel: track.channel || ''
    };

    // Evitar duplicados exactos
    const exists = this.playlists[playlistName].some(
      (t) => (t.urlYoutube && t.urlYoutube === cleanTrack.urlYoutube) || t.titulo === cleanTrack.titulo
    );

    if (exists) {
      return { success: false, message: `"${cleanTrack.titulo}" ya está en ${playlistName}.` };
    }

    this.playlists[playlistName].push(cleanTrack);
    this.save();
    return { success: true, track: cleanTrack };
  }

  removeTrack(playlistName, index) {
    if (!this.playlists[playlistName]) return false;
    if (index >= 0 && index < this.playlists[playlistName].length) {
      this.playlists[playlistName].splice(index, 1);
      this.save();
      return true;
    }
    return false;
  }

  reorderTracks(playlistName, fromIndex, toIndex) {
    const list = this.playlists[playlistName];
    if (!list) return;
    if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return;

    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    this.save();
  }

  /**
   * Obtiene la unión de todas las canciones sin duplicados para la sección "Todas las canciones"
   */
  getAllUniqueTracks() {
    const map = new Map();
    for (const tracks of Object.values(this.playlists)) {
      if (!Array.isArray(tracks)) continue;
      for (const t of tracks) {
        const key = (t.urlYoutube || t.titulo || '').toLowerCase().trim();
        if (key && !map.has(key)) {
          map.set(key, t);
        }
      }
    }
    return Array.from(map.values());
  }

  getStats(tracks) {
    const list = Array.isArray(tracks) ? tracks : [];
    let totalSecs = 0;
    list.forEach((t) => {
      totalSecs += duracionASegundos(t.duracion || t.duration);
    });
    return {
      count: list.length,
      durationText: formatearTiempoTotal(totalSecs),
      totalSeconds: totalSecs
    };
  }

  isFavorite(track) {
    if (!track || !this.playlists.Favoritas) return false;
    const url = track.urlYoutube || track.url;
    return this.playlists.Favoritas.some(
      (t) => (url && t.urlYoutube === url) || (t.titulo && t.titulo === (track.titulo || track.title))
    );
  }

  toggleFavorite(track) {
    if (this.isFavorite(track)) {
      const idx = this.playlists.Favoritas.findIndex(
        (t) =>
          ((track.urlYoutube || track.url) && t.urlYoutube === (track.urlYoutube || track.url)) ||
          t.titulo === (track.titulo || track.title)
      );
      if (idx !== -1) {
        this.removeTrack('Favoritas', idx);
        return false; // ya no es favorita
      }
    } else {
      this.addTrack('Favoritas', track);
      return true; // ahora es favorita
    }
    return false;
  }
}

export const playlistManager = new PlaylistManager();
