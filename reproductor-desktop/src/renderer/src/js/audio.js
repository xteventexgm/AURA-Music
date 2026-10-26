/**
 * AURA Music - Motor de Audio y Sincronización con MediaSession API
 */

import { obtenerEnlaceAudio } from './api.js';
import { isTrackDownloaded, getDownloadedTrackInfo } from './storage.js';

class AudioEngine {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.crossOrigin = 'anonymous';

    this.currentTrack = null;
    this.isLoading = false;
    this.trackProvider = null;
    this._playSessionId = 0;

    this.callbacks = {
      onPlay: () => {},
      onPause: () => {},
      onTimeUpdate: () => {},
      onDurationChange: () => {},
      onEnded: () => {},
      onError: () => {},
      onLoading: () => {},
      onNext: () => {},
      onPrev: () => {}
    };

    this.setupListeners();
    this.setupMediaSession();
  }

  setTrackProvider(fn) {
    this.trackProvider = fn;
  }

  getCurrentTrack() {
    return this.currentTrack;
  }

  hasSource() {
    return Boolean(this.audio.src && this.currentTrack);
  }

  setCallbacks(callbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  setupListeners() {
    this.audio.addEventListener('play', () => {
      this.updateMediaSessionState('playing');
      this.updateMediaSessionPosition();
      this.callbacks.onPlay(this.currentTrack);
    });

    this.audio.addEventListener('pause', () => {
      this.updateMediaSessionState('paused');
      this.updateMediaSessionPosition();
      this.callbacks.onPause(this.currentTrack);
    });

    let lastPositionSync = 0;
    this.audio.addEventListener('timeupdate', () => {
      this.callbacks.onTimeUpdate(this.audio.currentTime, this.audio.duration);
      const now = Date.now();
      if (now - lastPositionSync > 1500) {
        lastPositionSync = now;
        this.updateMediaSessionPosition();
      }
    });

    this.audio.addEventListener('seeked', () => {
      this.updateMediaSessionPosition();
    });

    this.audio.addEventListener('durationchange', () => {
      this.updateMediaSessionPosition();
      this.callbacks.onDurationChange(this.audio.duration);
    });

    this.audio.addEventListener('loadedmetadata', () => {
      this.updateMediaSessionPosition();
    });

    this.audio.addEventListener('ended', () => {
      this.callbacks.onEnded();
    });

    this.audio.addEventListener('error', (e) => {
      console.error('[AudioEngine] Error en elemento audio:', e);
      this.callbacks.onError(e);
    });
  }

  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    try {
      navigator.mediaSession.setActionHandler('play', () => this.play());
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.callbacks.onPrev());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.callbacks.onNext());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) {
          this.seek(details.seekTime);
        }
      });
    } catch (err) {
      console.warn('[AudioEngine] MediaSession handlers warning:', err);
    }
  }

  getTrackDurationSeconds(track) {
    if (!track) return 0;
    if (typeof track.seconds === 'number' && track.seconds > 0) return track.seconds;
    const durStr = track.duracion || track.duration;
    if (durStr && typeof durStr === 'string') {
      const parts = durStr.split(':').map(Number);
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return parts[0] * 60 + parts[1];
      }
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
    }
    return 0;
  }

  setMediaSessionPosition(duration, position = 0, rate = 1.0) {
    if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
    const dur = Math.max(0, Number(duration) || 0);
    const pos = Math.min(dur > 0 ? dur : 0, Math.max(0, Number(position) || 0));
    try {
      if (dur > 0) {
        navigator.mediaSession.setPositionState({
          duration: dur,
          playbackRate: rate,
          position: pos
        });
      }
    } catch (err) {
      console.warn('[AudioEngine] setPositionState warning:', err);
    }
  }

  resetMediaSessionPosition(track) {
    const durSec = this.getTrackDurationSeconds(track);
    this.setMediaSessionPosition(durSec > 0 ? durSec : 0, 0, 1.0);
  }

  updateMediaSessionMetadata(track) {
    if (!('mediaSession' in navigator) || !track) return;
    const isOffline = isTrackDownloaded(track) || track.tipo === 'offline';

    try {
      const artworkSrc = track.thumbnail || '/icon.png';
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.titulo || track.title || 'AURA Music',
        artist: track.channel || (isOffline ? 'AURA Offline 💾' : 'AURA Streaming'),
        album: isOffline ? 'AURA Offline' : 'AURA Desktop Player',
        artwork: [
          { src: artworkSrc, sizes: '96x96', type: 'image/jpeg' },
          { src: artworkSrc, sizes: '128x128', type: 'image/jpeg' },
          { src: artworkSrc, sizes: '192x192', type: 'image/jpeg' },
          { src: artworkSrc, sizes: '512x512', type: 'image/jpeg' },
          { src: '/icon.png', sizes: '512x512', type: 'image/png' }
        ]
      });
    } catch (e) {
      console.warn('[AudioEngine] Error actualizando MediaMetadata:', e);
    }
  }

  updateMediaSessionState(state) {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = state;
    }
  }

  updateMediaSessionPosition() {
    let dur = this.audio.duration;
    if (isNaN(dur) || dur <= 0 || !isFinite(dur)) {
      dur = this.getTrackDurationSeconds(this.currentTrack);
    }
    if (dur > 0) {
      this.setMediaSessionPosition(dur, this.audio.currentTime || 0, this.audio.playbackRate || 1.0);
    }
  }

  /**
   * Carga una pista por URL de YouTube o enlace directo de audio y la reproduce
   */
  async loadAndPlay(track) {
    if (!track) return false;

    const currentSession = ++this._playSessionId;
    this.currentTrack = track;
    this.isLoading = true;
    this.callbacks.onLoading(track);

    // Reiniciar inmediatamente metadatos y tiempo en la notificación para no heredar la pista previa
    this.updateMediaSessionMetadata(track);
    this.resetMediaSessionPosition(track);

    let streamUrl = track.audioUrl || track.streamUrl;
    const targetUrl = track.urlYoutube || track.url;

    // Si es un archivo descargado offline
    const downloaded = getDownloadedTrackInfo(track);
    if (downloaded && (downloaded.localUrl || downloaded.path)) {
      streamUrl = downloaded.localUrl || downloaded.path;
    } else if (track.isLocal || (targetUrl && (targetUrl.startsWith('file:') || targetUrl.endsWith('.mp3')))) {
      streamUrl = track.audioUrl || targetUrl;
    } else if (!streamUrl && targetUrl) {
      if (!navigator.onLine) {
        if (this._playSessionId === currentSession) {
          this.isLoading = false;
          this.callbacks.onError(new Error('Sin conexión a internet. Esta canción no ha sido descargada para escuchar offline.'));
        }
        return false;
      }
      try {
        streamUrl = await obtenerEnlaceAudio(targetUrl);
        if (this._playSessionId !== currentSession) return false;
        track.audioUrl = streamUrl; // Guardar en memoria de sesión
      } catch (err) {
        if (this._playSessionId === currentSession) {
          this.isLoading = false;
          this.callbacks.onError(err);
        }
        return false;
      }
    }

    if (this._playSessionId !== currentSession) return false;

    if (!streamUrl) {
      if (this._playSessionId === currentSession) {
        this.isLoading = false;
        this.callbacks.onError(new Error('No se pudo resolver el enlace de audio para esta pista.'));
      }
      return false;
    }

    try {
      this.audio.src = streamUrl;
      this.updateMediaSessionMetadata(track);
      await this.audio.play();
      if (this._playSessionId !== currentSession) return false;
      this.isLoading = false;
      return true;
    } catch (err) {
      if (this._playSessionId !== currentSession || err.name === 'AbortError') {
        return false;
      }
      // Si la URL en caché falló (token expirado tras recargar la página), reintentar resolviendo un enlace fresco (solo online)
      if (targetUrl && !track.isLocal && !targetUrl.startsWith('file:')) {
        console.warn('[AudioEngine] URL en caché falló, solicitando enlace fresco...');
        try {
          track.audioUrl = null;
          track.streamUrl = null;
          streamUrl = await obtenerEnlaceAudio(targetUrl);
          if (this._playSessionId !== currentSession) return false;
          track.audioUrl = streamUrl;
          this.audio.src = streamUrl;
          this.updateMediaSessionMetadata(track);
          await this.audio.play();
          if (this._playSessionId !== currentSession) return false;
          this.isLoading = false;
          return true;
        } catch (retryErr) {
          if (this._playSessionId !== currentSession || retryErr.name === 'AbortError') return false;
          console.error('[AudioEngine] Reintento falló:', retryErr);
        }
      }
      console.error('[AudioEngine] Error al reproducir audio:', err);
      if (this._playSessionId === currentSession) {
        this.isLoading = false;
        this.callbacks.onError(err);
      }
      return false;
    }
  }

  async play() {
    if (!this.audio.src) {
      if (typeof this.trackProvider === 'function') {
        const track = this.trackProvider();
        if (track) {
          return await this.loadAndPlay(track);
        }
      }
      return false;
    }
    try {
      await this.audio.play();
      return true;
    } catch (e) {
      console.error('[AudioEngine] Play error:', e);
      return false;
    }
  }

  pause() {
    this.audio.pause();
  }

  async togglePlay() {
    if (!this.audio.src) {
      if (typeof this.trackProvider === 'function') {
        const track = this.trackProvider();
        if (track) {
          return await this.loadAndPlay(track);
        }
      }
      return false;
    }

    if (this.audio.paused) {
      return await this.play();
    } else {
      this.pause();
      return true;
    }
  }

  seek(seconds) {
    if (!isNaN(this.audio.duration)) {
      this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration));
      this.updateMediaSessionPosition();
    }
  }

  seekPercentage(percent) {
    if (!isNaN(this.audio.duration)) {
      const target = (percent / 100) * this.audio.duration;
      this.seek(target);
    }
  }

  setVolume(val) {
    const clamped = Math.max(0, Math.min(1, val));
    this.audio.volume = clamped;
  }

  getVolume() {
    return this.audio.volume;
  }

  isPaused() {
    return this.audio.paused;
  }

  getCurrentTime() {
    return this.audio.currentTime || 0;
  }

  getDuration() {
    return this.audio.duration || 0;
  }
}

export const audioEngine = new AudioEngine();
