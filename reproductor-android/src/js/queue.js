/**
 * AURA Music - Gestor de Cola de Reproducción y Modo Aleatorio (Fisher-Yates)
 */

export class QueueManager {
  constructor() {
    this.queue = [];
    this.currentIndex = 0;
    this.isShuffle = false;
    this.shufflePool = [];
    this.shuffleCursor = 0;
    this.repeatMode = 'all'; // 'off' | 'all' | 'one'
  }

  setQueue(list, startIndex = 0) {
    this.queue = Array.isArray(list) ? [...list] : [];
    this.currentIndex = Math.max(0, Math.min(startIndex, this.queue.length - 1));

    if (this.isShuffle && this.queue.length > 0) {
      this.generateShuffleOrder(this.currentIndex);
    } else {
      this.shufflePool = [];
      this.shuffleCursor = 0;
    }
  }

  getRepeatMode() {
    return this.repeatMode;
  }

  toggleRepeat() {
    if (this.repeatMode === 'off') {
      this.repeatMode = 'all';
    } else if (this.repeatMode === 'all') {
      this.repeatMode = 'one';
    } else {
      this.repeatMode = 'off';
    }
    return this.repeatMode;
  }

  getCurrentTrack() {
    if (this.queue.length === 0) return null;
    return this.queue[this.currentIndex] || null;
  }

  getQueue() {
    return [...this.queue];
  }

  getCurrentIndex() {
    return this.currentIndex;
  }

  isShuffleActive() {
    return this.isShuffle;
  }

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;

    if (this.isShuffle && this.queue.length > 0) {
      this.generateShuffleOrder(this.currentIndex);
    } else {
      this.shufflePool = [];
      this.shuffleCursor = 0;
    }

    return this.isShuffle;
  }

  generateShuffleOrder(fixedIndex) {
    this.shufflePool = [];
    for (let i = 0; i < this.queue.length; i++) {
      if (i !== fixedIndex) this.shufflePool.push(i);
    }

    // Fisher-Yates Shuffle
    for (let i = this.shufflePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shufflePool[i], this.shufflePool[j]] = [this.shufflePool[j], this.shufflePool[i]];
    }

    // La canción actual al principio del pool
    this.shufflePool.unshift(fixedIndex);
    this.shuffleCursor = 0;
  }

  next(isAutoEnded = false) {
    if (this.queue.length === 0) return null;

    // Si terminó automáticamente y está en modo repetir una pista
    if (isAutoEnded && this.repeatMode === 'one') {
      return this.getCurrentTrack();
    }

    if (this.isShuffle) {
      this.shuffleCursor++;
      if (this.shuffleCursor >= this.shufflePool.length) {
        if (this.repeatMode === 'off' && isAutoEnded) {
          return null;
        }
        this.shuffleCursor = 0;
      }
      this.currentIndex = this.shufflePool[this.shuffleCursor];
    } else {
      this.currentIndex++;
      if (this.currentIndex >= this.queue.length) {
        if (this.repeatMode === 'off' && isAutoEnded) {
          return null;
        }
        this.currentIndex = 0;
      }
    }

    return this.getCurrentTrack();
  }

  prev() {
    if (this.queue.length === 0) return null;

    if (this.isShuffle) {
      this.shuffleCursor = this.shuffleCursor > 0 ? this.shuffleCursor - 1 : 0;
      this.currentIndex = this.shufflePool[this.shuffleCursor];
    } else {
      this.currentIndex = this.currentIndex > 0 ? this.currentIndex - 1 : this.queue.length - 1;
    }

    return this.getCurrentTrack();
  }

  jumpTo(index) {
    if (index >= 0 && index < this.queue.length) {
      this.currentIndex = index;
      if (this.isShuffle) {
        this.generateShuffleOrder(this.currentIndex);
      }
      return this.getCurrentTrack();
    }
    return null;
  }

  addTrack(track) {
    if (!track) return;
    this.queue.push(track);
    if (this.isShuffle) {
      this.shufflePool.push(this.queue.length - 1);
    }
  }

  removeTrack(index) {
    if (index >= 0 && index < this.queue.length) {
      this.queue.splice(index, 1);
      if (index < this.currentIndex) {
        this.currentIndex--;
      } else if (this.currentIndex >= this.queue.length) {
        this.currentIndex = Math.max(0, this.queue.length - 1);
      }
      if (this.isShuffle && this.queue.length > 0) {
        this.generateShuffleOrder(this.currentIndex);
      }
    }
  }

  reorder(fromIndex, toIndex) {
    if (
      fromIndex < 0 ||
      fromIndex >= this.queue.length ||
      toIndex < 0 ||
      toIndex >= this.queue.length ||
      fromIndex === toIndex
    ) {
      return false;
    }

    const currentTrack = this.getCurrentTrack();
    const [moved] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, moved);

    if (currentTrack) {
      const newCurr = this.queue.findIndex(
        (t) => (t.urlYoutube || t.url || t.titulo) === (currentTrack.urlYoutube || currentTrack.url || currentTrack.titulo)
      );
      if (newCurr !== -1) {
        this.currentIndex = newCurr;
      }
    }

    if (this.isShuffle && this.queue.length > 0) {
      this.generateShuffleOrder(this.currentIndex);
    }

    return true;
  }

  clear() {
    this.queue = [];
    this.currentIndex = 0;
    this.shufflePool = [];
    this.shuffleCursor = 0;
  }

  exportState() {
    return {
      queue: this.queue,
      currentIndex: this.currentIndex,
      isShuffle: this.isShuffle,
      shufflePool: this.shufflePool,
      shuffleCursor: this.shuffleCursor
    };
  }

  restoreState(state) {
    if (!state) return;
    this.queue = Array.isArray(state.queue) ? state.queue : [];
    this.currentIndex = typeof state.currentIndex === 'number' ? state.currentIndex : 0;
    this.isShuffle = Boolean(state.isShuffle);
    this.shufflePool = Array.isArray(state.shufflePool) ? state.shufflePool : [];
    this.shuffleCursor = typeof state.shuffleCursor === 'number' ? state.shuffleCursor : 0;
  }
}

export const queueManager = new QueueManager();
