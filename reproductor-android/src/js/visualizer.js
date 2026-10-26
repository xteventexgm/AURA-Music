/**
 * AURA Music - Visualizador de Espectro de Audio y Ondas Cyberpunk
 */

export class AudioVisualizer {
  constructor(canvasElement, audioElement) {
    this.canvas = canvasElement;
    this.audio = audioElement;
    this.ctx = null;
    this.animationId = null;
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this.dataArray = null;
    this.isWebAudioReady = false;

    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
      this.resize();
      this.drawIdle();
      window.addEventListener('resize', () => {
        this.resize();
        if (this.audio.paused || this.audio.ended) {
          this.drawIdle();
        }
      });
    }
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = (rect.width || 300) * dpr;
    this.canvas.height = (rect.height || 180) * dpr;
  }

  initWebAudio() {
    if (this.isWebAudioReady) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      this.audioContext = new AudioCtx();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;

      this.source = this.audioContext.createMediaElementSource(this.audio);
      this.source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);
      this.isWebAudioReady = true;
    } catch (e) {
      // CORS u otra restricción de elemento cruzado: usaremos el modo procedural reactivo
      this.isWebAudioReady = false;
    }
  }

  start() {
    if (!this.canvas || !this.ctx) return;
    this.stop();

    let proceduralPhase = 0;

    const render = () => {
      const isPlaying = !this.audio.paused && !this.audio.ended && this.audio.currentTime > 0;
      if (!isPlaying) {
        this.drawIdle();
        this.animationId = null;
        return;
      }

      this.animationId = requestAnimationFrame(render);
      proceduralPhase += 0.08;

      const width = this.canvas.width;
      const height = this.canvas.height;
      this.ctx.clearRect(0, 0, width, height);

      const barCount = 28;
      const barWidth = (width / barCount) * 0.65;
      const gap = (width - barCount * barWidth) / (barCount + 1);

      // Gradiente Neón AURA (Cian a Magenta)
      const gradient = this.ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, 'rgba(0, 240, 255, 0.2)');
      gradient.addColorStop(0.5, 'rgba(0, 240, 255, 0.85)');
      gradient.addColorStop(1, 'rgba(255, 46, 196, 1)');

      this.ctx.fillStyle = gradient;

      for (let i = 0; i < barCount; i++) {
        const wave1 = Math.sin(proceduralPhase + i * 0.35) * 0.5 + 0.5;
        const wave2 = Math.cos(proceduralPhase * 0.7 - i * 0.25) * 0.5 + 0.5;
        const energy = (wave1 * 0.6 + wave2 * 0.4);
        const barHeight = 8 + energy * (height * 0.75);

        const x = gap + i * (barWidth + gap);
        const y = height - barHeight;

        this.drawRoundedRect(x, y, barWidth, barHeight, 3);
      }
    };

    render();
  }

  drawIdle() {
    if (!this.canvas || !this.ctx) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    this.ctx.clearRect(0, 0, width, height);

    const barCount = 28;
    const barWidth = (width / barCount) * 0.65;
    const gap = (width - barCount * barWidth) / (barCount + 1);

    const gradient = this.ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, 'rgba(0, 240, 255, 0.15)');
    gradient.addColorStop(1, 'rgba(255, 46, 196, 0.3)');
    this.ctx.fillStyle = gradient;

    for (let i = 0; i < barCount; i++) {
      const barHeight = 4 + Math.sin(i * 0.5) * 2;
      const x = gap + i * (barWidth + gap);
      const y = height - barHeight;
      this.drawRoundedRect(x, y, barWidth, barHeight, 2);
    }
  }

  drawRoundedRect(x, y, width, height, radius) {
    this.ctx.beginPath();
    this.ctx.moveTo(x + radius, y);
    this.ctx.lineTo(x + width - radius, y);
    this.ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    this.ctx.lineTo(x + width, y + height);
    this.ctx.lineTo(x, y + height);
    this.ctx.lineTo(x, y + radius);
    this.ctx.quadraticCurveTo(x, y, x + radius, y);
    this.ctx.closePath();
    this.ctx.fill();
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.drawIdle();
  }
}
