/**
 * AURA Music - Servicio de Códigos QR (Generación y Escaneo)
 * Utiliza QRious para generar y Html5Qrcode para escanear.
 */

import { extraerVideoId, obtenerDetallesVideo } from './api.js';

export class QrService {
  constructor() {
    this.html5QrCode = null;
    this.isScanning = false;
  }

  /**
   * Genera un código QR en un elemento <canvas>
   */
  generateQr(canvasElement, value) {
    if (!canvasElement) return null;
    if (typeof window.QRious === 'undefined') {
      console.error('[QR] Librería QRious no cargada');
      return null;
    }

    try {
      return new window.QRious({
        element: canvasElement,
        value: typeof value === 'string' ? value : JSON.stringify(value),
        size: 260,
        background: '#0e0e1a',
        foreground: '#00f0ff',
        level: 'M'
      });
    } catch (err) {
      console.error('[QR] Error generando código:', err);
      return null;
    }
  }

  /**
   * Prepara el payload QR para compartir una canción
   */
  generateSongPayload(track) {
    return JSON.stringify({
      app: 'aura',
      type: 'song',
      title: track.titulo || track.title,
      url: track.urlYoutube || track.url,
      vId: extraerVideoId(track.urlYoutube || track.url)
    });
  }

  /**
   * Prepara el payload QR para compartir una playlist (optimizado con IDs)
   */
  generatePlaylistPayload(name, tracks) {
    const list = Array.isArray(tracks) ? tracks : [];
    const ids = list
      .map((t) => extraerVideoId(t.urlYoutube || t.url))
      .filter(Boolean)
      .slice(0, 35); // Limitar a 35 para no desbordar el tamaño estándar del QR

    return JSON.stringify({
      app: 'aura',
      type: 'playlist',
      name: name,
      count: ids.length,
      ids: ids
    });
  }

  /**
   * Inicia el escáner de cámara
   */
  async startCameraScanner(elementId, onDecoded, onError) {
    if (typeof window.Html5Qrcode === 'undefined') {
      throw new Error('Librería de escaneo no disponible.');
    }

    if (this.isScanning) {
      await this.stopScanner();
    }

    try {
      this.html5QrCode = new window.Html5Qrcode(elementId);
      const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
      };

      await this.html5QrCode.start(
        { facingMode: 'environment' },
        config,
        (decodedText) => {
          this.handleDecodedText(decodedText, onDecoded);
        },
        (errorMessage) => {
          if (onError) onError(errorMessage);
        }
      );
      this.isScanning = true;
      return true;
    } catch (err) {
      console.error('[QR] Error al iniciar cámara:', err);
      this.isScanning = false;
      throw err;
    }
  }

  /**
   * Detiene el escáner de cámara
   */
  async stopScanner() {
    if (this.html5QrCode && this.isScanning) {
      try {
        await this.html5QrCode.stop();
        this.html5QrCode.clear();
      } catch (err) {
        console.warn('[QR] Error al detener scanner:', err);
      } finally {
        this.isScanning = false;
      }
    }
  }

  /**
   * Escanea una imagen subida desde archivo
   */
  async scanFile(file, onDecoded) {
    if (typeof window.Html5Qrcode === 'undefined') {
      throw new Error('Librería de escaneo no disponible.');
    }

    const scanner = new window.Html5Qrcode('qr-hidden-scanner');
    try {
      const decodedText = await scanner.scanFile(file, true);
      await this.handleDecodedText(decodedText, onDecoded);
      scanner.clear();
      return true;
    } catch (err) {
      scanner.clear();
      throw new Error('No se detectó ningún código QR en la imagen.');
    }
  }

  /**
   * Parsea e interpreta el texto decodificado
   */
  async handleDecodedText(text, callback) {
    try {
      // Intentar parsear como JSON AURA
      if (text.startsWith('{') && text.endsWith('}')) {
        const payload = JSON.parse(text);
        if (payload.app === 'aura' || payload.type) {
          callback({ success: true, isAura: true, payload });
          return;
        }
      }

      // Si es un link de YouTube directo
      const videoId = extraerVideoId(text);
      if (videoId) {
        const details = await obtenerDetallesVideo(videoId);
        if (details) {
          callback({
            success: true,
            isAura: false,
            payload: {
              type: 'song',
              title: details.title,
              url: details.url,
              thumbnail: details.thumbnail,
              duration: details.duration
            }
          });
          return;
        }
      }

      // Texto plano
      callback({ success: true, isAura: false, payload: { type: 'text', raw: text } });
    } catch (err) {
      console.error('[QR] Error procesando QR decodificado:', err);
      callback({ success: false, error: err.message });
    }
  }
}

export const qrService = new QrService();
