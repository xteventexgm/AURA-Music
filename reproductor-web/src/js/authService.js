/**
 * AURA Music - Servicio de Autenticación, Nube y Sincronización Atlas
 */

const STORAGE_KEYS = {
  SERVER_URL: 'aura_server_url',
  AUTH_TOKEN: 'aura_auth_token',
  USER_DATA: 'aura_user_data',
  AUTO_SYNC: 'aura_auto_sync_enabled'
};

const DEFAULT_SERVER_URL = 'http://localhost:3001';

class AuthService {
  constructor() {
    this.token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) || null;
    this.user = null;
    this.subscribers = new Set();

    try {
      const savedUser = localStorage.getItem(STORAGE_KEYS.USER_DATA);
      if (savedUser) {
        this.user = JSON.parse(savedUser);
      }
    } catch {}
  }

  getServerUrl() {
    return localStorage.getItem(STORAGE_KEYS.SERVER_URL) || DEFAULT_SERVER_URL;
  }

  setServerUrl(url) {
    if (!url) return;
    const clean = url.trim().replace(/\/+$/, '');
    localStorage.setItem(STORAGE_KEYS.SERVER_URL, clean);
    this.notify();
  }

  getToken() {
    return this.token;
  }

  getUser() {
    return this.user;
  }

  isLoggedIn() {
    return Boolean(this.token && this.user);
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notify() {
    for (const cb of this.subscribers) {
      try { cb(this.user, this.isLoggedIn()); } catch {}
    }
  }

  getHeaders(includeAuth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (includeAuth && this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  async checkServerHealth() {
    try {
      const res = await fetch(`${this.getServerUrl()}/health`, { method: 'GET' });
      if (!res.ok) return { online: false };
      const data = await res.json();
      return { online: true, ...data };
    } catch {
      return { online: false };
    }
  }

  async login(email, password) {
    const res = await fetch(`${this.getServerUrl()}/api/auth/login`, {
      method: 'POST',
      headers: this.getHeaders(false),
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || data.message || 'Error al iniciar sesión');
    }

    this.setSession(data.token, data.user);
    return data.user;
  }

  async register(username, email, password) {
    const res = await fetch(`${this.getServerUrl()}/api/auth/register`, {
      method: 'POST',
      headers: this.getHeaders(false),
      body: JSON.stringify({ username, email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || data.message || 'Error al registrar usuario');
    }

    this.setSession(data.token, data.user);
    return data.user;
  }

  async loginWithGoogle(credential, profile = null) {
    const res = await fetch(`${this.getServerUrl()}/api/auth/google`, {
      method: 'POST',
      headers: this.getHeaders(false),
      body: JSON.stringify({ credential, profile })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || data.message || 'Error al autenticar con Google');
    }

    this.setSession(data.token, data.user);
    return data.user;
  }

  setSession(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
    localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(user));
    this.notify();
  }

  logout() {
    this.token = null;
    this.user = null;
    localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER_DATA);
    this.notify();
  }

  async fetchProfile() {
    if (!this.token) return null;
    try {
      const res = await fetch(`${this.getServerUrl()}/api/auth/me`, {
        method: 'GET',
        headers: this.getHeaders(true)
      });
      if (res.ok) {
        const data = await res.json();
        this.user = data.user;
        localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(data.user));
        this.notify();
        return this.user;
      }
      if (res.status === 401) {
        this.logout();
      }
    } catch (err) {
      console.warn('[AuthService] No se pudo sincronizar perfil:', err);
    }
    return this.user;
  }

  // Sincronización en la Nube (MongoDB Atlas)
  async fetchCloudData() {
    if (!this.token) return null;
    const res = await fetch(`${this.getServerUrl()}/api/sync/data`, {
      method: 'GET',
      headers: this.getHeaders(true)
    });
    if (!res.ok) throw new Error('Error al descargar datos de la nube');
    return await res.json();
  }

  async syncPlaylistsToCloud(playlistsObj) {
    if (!this.token) return false;
    const formatted = Object.entries(playlistsObj).map(([name, tracks]) => ({
      name,
      tracks: (tracks || []).map((t) => ({
        id: t.id || t.videoId || t.urlYoutube || t.url,
        title: t.title || t.titulo || 'Pista',
        artist: t.channel || t.artist || 'AURA',
        duration: t.duration || t.duracion || '0:00',
        thumbnail: t.thumbnail || ''
      }))
    }));

    const res = await fetch(`${this.getServerUrl()}/api/sync/playlists`, {
      method: 'POST',
      headers: this.getHeaders(true),
      body: JSON.stringify({ playlists: formatted })
    });
    return res.ok;
  }

  async syncLikesToCloud(favTracks) {
    if (!this.token) return false;
    const tracks = (favTracks || []).map((t) => ({
      id: t.id || t.videoId || t.urlYoutube || t.url,
      title: t.title || t.titulo || 'Pista',
      artist: t.channel || t.artist || 'AURA',
      duration: t.duration || t.duracion || '0:00',
      thumbnail: t.thumbnail || ''
    }));

    const res = await fetch(`${this.getServerUrl()}/api/sync/likes`, {
      method: 'POST',
      headers: this.getHeaders(true),
      body: JSON.stringify({ tracks })
    });
    return res.ok;
  }

  async createCloudBackup(name, playlists, likedTracks) {
    if (!this.token) throw new Error('Inicia sesión para crear copias en la nube');
    const res = await fetch(`${this.getServerUrl()}/api/sync/backup`, {
      method: 'POST',
      headers: this.getHeaders(true),
      body: JSON.stringify({ name, playlists, likedTracks })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al crear respaldo');
    return data.backup;
  }

  async listCloudBackups() {
    if (!this.token) return [];
    const res = await fetch(`${this.getServerUrl()}/api/sync/backups`, {
      method: 'GET',
      headers: this.getHeaders(true)
    });
    if (!res.ok) return [];
    return await res.json();
  }

  async restoreCloudBackup(backupId) {
    if (!this.token) throw new Error('Inicia sesión para restaurar respaldos');
    const res = await fetch(`${this.getServerUrl()}/api/sync/restore/${backupId}`, {
      method: 'POST',
      headers: this.getHeaders(true)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al restaurar respaldo');
    return data.payload;
  }

  // Feed Inteligente y Tendencias
  async getPersonalizedFeed() {
    try {
      const res = await fetch(`${this.getServerUrl()}/api/recommendations`, {
        method: 'GET',
        headers: this.getHeaders(Boolean(this.token))
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.feed || [];
    } catch {
      return [];
    }
  }

  async getTrending(category = 'pop') {
    try {
      const res = await fetch(`${this.getServerUrl()}/api/trending?category=${encodeURIComponent(category)}`, {
        method: 'GET',
        headers: this.getHeaders(false)
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.tracks || [];
    } catch {
      return [];
    }
  }

  // Importar con Filtro Inteligente de No-Música
  async importFromYouTubeUrl(url) {
    const res = await fetch(`${this.getServerUrl()}/api/import`, {
      method: 'POST',
      headers: this.getHeaders(false),
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al importar de YouTube');
    return data;
  }

  async recordListen(track, listenedSeconds = 0, completed = false) {
    if (!this.token || !track) return;
    try {
      await fetch(`${this.getServerUrl()}/api/sync/history`, {
        method: 'POST',
        headers: this.getHeaders(true),
        body: JSON.stringify({
          trackId: track.id || track.videoId || track.urlYoutube || track.url,
          title: track.title || track.titulo || 'Música',
          artist: track.channel || track.artist || 'AURA',
          duration: track.duration || track.duracion || '0:00',
          thumbnail: track.thumbnail || '',
          listenedSeconds,
          completed
        })
      });
    } catch {}
  }
}

export const authService = new AuthService();
