/**
 * AURA Music - Modo Conducción (Car Mode)
 * Interfaz ultra-accesible para vehículos con bloqueo de apagado de pantalla (Wake Lock API)
 */

export class CarModeManager {
  constructor(audioEngine, queueManager) {
    this.audioEngine = audioEngine;
    this.queueManager = queueManager;
    this.wakeLock = null;
    this.container = null;
    this.isOpen = false;
  }

  init(containerElement) {
    this.container = containerElement;
    if (!this.container) return;

    this.titleEl = this.container.querySelector('#carTitulo');
    this.artistEl = this.container.querySelector('#carArtista');
    this.btnPlay = this.container.querySelector('#carBtnPlay');
    this.btnPrev = this.container.querySelector('#carBtnPrev');
    this.btnNext = this.container.querySelector('#carBtnNext');
    this.btnExit = this.container.querySelector('#btnExitCarMode');

    if (this.btnPlay) {
      this.btnPlay.addEventListener('click', async () => {
        await this.audioEngine.togglePlay();
        this.update();
      });
    }

    if (this.btnPrev) {
      this.btnPrev.addEventListener('click', () => {
        const prevTrack = this.queueManager.prev();
        if (prevTrack) this.audioEngine.loadAndPlay(prevTrack);
      });
    }

    if (this.btnNext) {
      this.btnNext.addEventListener('click', () => {
        const nextTrack = this.queueManager.next();
        if (nextTrack) this.audioEngine.loadAndPlay(nextTrack);
      });
    }

    if (this.btnExit) {
      this.btnExit.addEventListener('click', () => this.close());
    }
  }

  async open() {
    if (!this.container) return;
    this.container.classList.remove('vista-oculta');
    this.container.classList.add('open');
    this.isOpen = true;
    this.update();
    await this.requestWakeLock();
  }

  async close() {
    if (!this.container) return;
    this.container.classList.add('vista-oculta');
    this.container.classList.remove('open');
    this.isOpen = false;
    await this.releaseWakeLock();
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  update() {
    if (!this.isOpen || !this.container) return;

    const track = this.queueManager.getCurrentTrack();
    if (track) {
      if (this.titleEl) this.titleEl.innerText = track.titulo || track.title || 'Música';
      if (this.artistEl) this.artistEl.innerText = track.channel || 'AURA Streaming';
    } else {
      if (this.titleEl) this.titleEl.innerText = 'No hay música seleccionada';
      if (this.artistEl) this.artistEl.innerText = 'AURA Music';
    }

    if (this.btnPlay) {
      if (this.audioEngine.isPaused()) {
        this.btnPlay.innerHTML = '<i class="ph-fill ph-play"></i>';
      } else {
        this.btnPlay.innerHTML = '<i class="ph-fill ph-pause"></i>';
      }
    }
  }

  async requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        console.log('[CarMode] Pantalla bloqueada contra apagado (WakeLock activo)');
      } catch (err) {
        console.warn('[CarMode] WakeLock no permitido o no soportado:', err);
      }
    }
  }

  async releaseWakeLock() {
    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
        this.wakeLock = null;
        console.log('[CarMode] WakeLock liberado');
      } catch (err) {
        console.warn('[CarMode] Error liberando WakeLock:', err);
      }
    }
  }
}
