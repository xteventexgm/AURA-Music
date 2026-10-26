/**
 * AURA Music - Punto de Entrada Principal (Main Orchestrator)
 */

import {
  initConfig,
  getRapidApiKeys,
  addRapidApiKey,
  removeRapidApiKey,
  resetRapidApiKeys,
  getYoutubeApiKey,
  setYoutubeApiKey,
  resetYoutubeApiKey
} from './config.js';

import {
  loadStoredData,
  saveStoredData,
  exportBackupFile,
  importBackupJson,
  isTrackDownloaded,
  getDownloadedTrackInfo,
  registerDownloadedTrack,
  unregisterDownloadedTrack
} from './storage.js';

import {
  buscarMusica,
  extraerVideoId,
  extraerPlaylistId,
  obtenerDetallesVideo,
  obtenerVideosDePlaylist,
  obtenerNombrePlaylist,
  formatearTiempoTotal
} from './api.js';

import { audioEngine } from './audio.js';
import { queueManager } from './queue.js';
import { playlistManager } from './playlists.js';
import { qrService } from './qrService.js';
import { CarModeManager } from './carMode.js';
import { AudioVisualizer } from './visualizer.js';
import { uiManager } from './ui.js';

// Estado en memoria
let busquedasRecientes = [];
let ultimosResultadosBusqueda = [];
let carModeManager = null;
let visualizer = null;
let currentPlaylistViewName = null;
let isUserDraggingSlider = false;
let previousVolume = 1;

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 [AURA] Iniciando reproductor de música web...');

  // 1. Inicializar configuración y almacenamiento
  initConfig();
  const savedState = loadStoredData();
  busquedasRecientes = savedState.busquedasRecientes || [];

  // Restaurar cola previa si existía
  if (savedState.ultimaCola && savedState.ultimaCola.length > 0) {
    queueManager.restoreState({
      queue: savedState.ultimaCola,
      currentIndex: savedState.ultimoIndice || 0,
      isShuffle: savedState.ultimoModoAleatorio || false,
      shufflePool: savedState.ultimoPool || [],
      shuffleCursor: savedState.ultimoCursor || 0
    });
  }

  // 2. Inicializar Módulos UI y Controladores
  initDesktopTitlebar();
  initNavigation();
  initSearch();
  initPlaylists();
  initPlayerControls();
  initSettings();
  initQrModals();
  initKeyboardShortcuts();
  initNetworkDetection();

  // Modo Conducción
  const carModeContainer = document.getElementById('vista-car-mode');
  carModeManager = new CarModeManager(audioEngine, queueManager);
  carModeManager.init(carModeContainer);
  document.getElementById('btnCarModeToggle')?.addEventListener('click', () => {
    carModeManager.open();
  });

  // Visualizador de Audio (Canvas)
  const canvas = document.getElementById('ecualizadorVisual');
  visualizer = new AudioVisualizer(canvas, audioEngine.audio);

  // 3. Conectar AudioEngine Callbacks
  audioEngine.setCallbacks({
    onPlay: (track) => {
      const current = track || queueManager.getCurrentTrack();
      if (current) syncTrackMetadataUI(current);
      updatePlayPauseIcons(false);
      document.getElementById('fsVinylWrapper')?.classList.add('is-playing');
      visualizer.initWebAudio();
      visualizer.start();
      carModeManager.update();
    },
    onPause: (track) => {
      updatePlayPauseIcons(true);
      document.getElementById('fsVinylWrapper')?.classList.remove('is-playing');
      visualizer.stop();
      carModeManager.update();
    },
    onTimeUpdate: (currentTime, duration) => {
      updateProgressDisplay(currentTime, duration);
    },
    onEnded: () => {
      visualizer.stop();
      playNextTrack(true);
    },
    onError: (err) => {
      visualizer.stop();
      uiManager.showToast(`⚠️ ${err.message || 'Error al reproducir audio'}`);
      updatePlayPauseIcons(true);
      const current = queueManager.getCurrentTrack();
      if (current) syncTrackMetadataUI(current);
    },
    onLoading: (track) => {
      const title = track.titulo || track.title || 'Música';
      updateMarqueeTitle('playerBarTitleTrack', title, 'playerBarTitle', 'player-bar-title');
      updateMarqueeTitle('fsTrackTitleTrack', title, 'fsTrackTitle', 'fs-track-title');
      updateMarqueeTitle('miniTitleTrack', title, 'miniTitle', 'mini-title');

      const isOffline = isTrackDownloaded(track) || track.tipo === 'offline';

      const barArtist = document.getElementById('playerBarArtist');
      if (barArtist) {
        barArtist.innerText = isOffline
          ? (track.channel ? `${track.channel} • Offline 💾` : 'Audio Local (Offline) 💾')
          : `Conectando audio online... ⏳`;
      }

      const fsArtist = document.getElementById('fsTrackArtist');
      if (fsArtist) {
        fsArtist.innerText = isOffline
          ? (track.channel ? `${track.channel} • Offline 💾` : 'AURA Offline 💾')
          : `Conectando con AURA Stream... ☁️`;
      }

      const miniArtist = document.getElementById('miniArtist');
      if (miniArtist) {
        miniArtist.innerText = isOffline
          ? (track.channel || 'Offline 💾')
          : `Conectando... ⏳`;
      }

      // Si la pista está descargada, no mostrar aviso de conexión online
      if (!isOffline) {
        uiManager.showToast(`Conectando audio online... ☁️`);
      }
    },
    onNext: () => playNextTrack(false),
    onPrev: () => playPrevTrack()
  });

  // Conectar track provider para autorecuperar la pista restaurada al pulsar play
  audioEngine.setTrackProvider(() => queueManager.getCurrentTrack());

  // Si había una canción guardada en cola previa, mostrar en el dock sin autorreproducir
  const initialTrack = queueManager.getCurrentTrack();
  if (initialTrack) {
    syncTrackMetadataUI(initialTrack);
    document.getElementById('playerBar')?.classList.remove('hidden');
  }

  // Inicializar estado visual de repetición y volumen
  updateRepeatUI(queueManager.getRepeatMode());
  updateVolumeUI(audioEngine.getVolume());

  // Renderizar estado inicial de búsquedas recientes y playlists
  uiManager.renderRecentSearches(busquedasRecientes, (query) => executeSearch(query), (term) => {
    busquedasRecientes = busquedasRecientes.filter((t) => t !== term);
    saveStoredData({ busquedasRecientes });
    uiManager.renderRecentSearches(busquedasRecientes, (q) => executeSearch(q), (t) => {});
  });

  uiManager.renderPlaylists(playlistManager.getPlaylists(), (name, tracks) => openPlaylistDetail(name, tracks));
  uiManager.renderRapidKeysList(getRapidApiKeys(), (index) => {
    removeRapidApiKey(index);
    uiManager.renderRapidKeysList(getRapidApiKeys(), (idx) => {});
    uiManager.showToast('Llave eliminada.');
  });

  // Mostrar llave de YouTube en el input
  const inputYt = document.getElementById('inputYoutubeKey');
  if (inputYt) inputYt.value = getYoutubeApiKey();

  // Recalcular desplazamiento animado del título si la ventana cambia de tamaño
  window.addEventListener('resize', () => {
    const cur = queueManager.getCurrentTrack();
    if (cur) {
      const t = cur.titulo || cur.title || 'Música';
      updateMarqueeTitle('playerBarTitleTrack', t, 'playerBarTitle', 'player-bar-title');
      updateMarqueeTitle('fsTrackTitleTrack', t, 'fsTrackTitle', 'fs-track-title');
      updateMarqueeTitle('miniTitleTrack', t, 'miniTitle', 'mini-title');
    }
  });

  console.log('✅ [AURA] Listo y operativo.');
});

/* ======================================================
   NAVEGACIÓN POR PESTAÑAS (TABS)
====================================================== */
function initNavigation() {
  const tabs = document.querySelectorAll('.nav-tab-btn');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const viewId = tab.dataset.view;
      uiManager.switchTab(viewId);

      // Si cambiamos a biblioteca, refrescar las playlists
      if (viewId === 'vista-biblioteca') {
        uiManager.renderPlaylists(playlistManager.getPlaylists(), (name, tracks) => openPlaylistDetail(name, tracks));
      }
    });
  });

  // Botón volver de detalle de playlist
  document.getElementById('btnVolverBiblioteca')?.addEventListener('click', () => {
    document.getElementById('vista-playlist-detalle')?.classList.remove('view-active');
    document.getElementById('vista-biblioteca')?.classList.add('view-active');
  });
}

/* ======================================================
   BÚSQUEDA Y CATEGORÍAS
====================================================== */
function initSearch() {
  const input = document.getElementById('inputBusqueda');
  const btnBuscar = document.getElementById('btnBuscar');
  const btnClear = document.getElementById('btnClearSearch');

  async function performSearch() {
    const q = input.value.trim();
    if (!q) return;
    executeSearch(q);
  }

  btnBuscar?.addEventListener('click', performSearch);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch();
  });

  input?.addEventListener('input', () => {
    if (input.value.trim().length > 0) {
      btnClear.classList.add('visible');
    } else {
      btnClear.classList.remove('visible');
    }
  });

  btnClear?.addEventListener('click', () => {
    input.value = '';
    btnClear.classList.remove('visible');
    input.focus();
  });

  // Chips de categorías rápidas
  document.querySelectorAll('.chip-tag').forEach((chip) => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.query;
      input.value = q;
      btnClear.classList.add('visible');
      executeSearch(q);
    });
  });

  // Botón limpiar recientes
  document.getElementById('btnLimpiarRecientes')?.addEventListener('click', () => {
    busquedasRecientes = [];
    saveStoredData({ busquedasRecientes });
    uiManager.renderRecentSearches([], null, null);
    uiManager.showToast('Historial de búsquedas vaciado.');
  });
}

async function executeSearch(query) {
  const list = document.getElementById('listaBusqueda');
  if (list) {
    list.innerHTML = `
      <li style="text-align: center; color: var(--neon-cyan); padding: 40px 0;">
        <i class="ph-bold ph-spinner" style="font-size: 2rem; animation: spinVinyl 1s linear infinite; display: inline-block;"></i>
        <p style="margin-top: 10px; font-weight: 600;">Buscando "${query}" en AURA...</p>
      </li>
    `;
  }

  // Guardar en recientes
  busquedasRecientes = busquedasRecientes.filter((t) => t.toLowerCase() !== query.toLowerCase());
  busquedasRecientes.unshift(query);
  if (busquedasRecientes.length > 8) busquedasRecientes.pop();
  saveStoredData({ busquedasRecientes });

  uiManager.renderRecentSearches(busquedasRecientes, (q) => executeSearch(q), (term) => {
    busquedasRecientes = busquedasRecientes.filter((t) => t !== term);
    saveStoredData({ busquedasRecientes });
    uiManager.renderRecentSearches(busquedasRecientes, (q2) => executeSearch(q2), () => {});
  });

  try {
    const results = await buscarMusica(query);
    ultimosResultadosBusqueda = results || [];
    renderActiveSearchResults(ultimosResultadosBusqueda);
  } catch (err) {
    console.error(err);
    if (list) {
      list.innerHTML = `
        <li style="text-align: center; color: var(--neon-red); padding: 40px 0;">
          <p>⚠️ ${err.message}</p>
        </li>
      `;
    }
  }
}

function renderActiveSearchResults(results) {
  if (!results || results.length === 0) return;
  uiManager.renderSearchResults(results, {
    onPlay: (track, allResults, index) => {
      // Establecer la cola con los resultados de la búsqueda
      queueManager.setQueue(allResults, index);
      playCurrentTrack();
    },
    onToggleFav: (track, favBtn) => {
      const isFav = playlistManager.toggleFavorite(track);
      favBtn.classList.toggle('is-fav', isFav);
      favBtn.innerHTML = `<i class="${isFav ? 'ph-fill ph-heart' : 'ph-bold ph-heart'}"></i>`;
      uiManager.showToast(isFav ? `❤️ Añadida a Favoritas` : `💔 Eliminada de Favoritas`);
      updateFsFavButton();
    },
    onAddToPlaylist: (track) => {
      uiManager.openAddToPlaylistModal(track, playlistManager.getPlaylists(), (plName, song, itemEl) => {
        const res = playlistManager.addTrack(plName, song);
        if (res.success) {
          uiManager.showToast(`Guardada en "${plName}" ✨`);
          if (itemEl) {
            itemEl.classList.add('already-added');
            const actionEl = itemEl.querySelector('.playlist-picker-action');
            if (actionEl) {
              actionEl.innerHTML = '<span class="picker-badge-added"><i class="ph-fill ph-check-circle"></i> Añadida</span>';
            }
            const countEl = itemEl.querySelector('.playlist-picker-count');
            if (countEl) {
              const count = playlistManager.getTracks(plName).length;
              countEl.innerText = `${count} canción${count === 1 ? '' : 'es'}`;
            }
          }
          uiManager.renderPlaylists(playlistManager.getPlaylists(), (n, t) => openPlaylistDetail(n, t));
        } else {
          uiManager.showToast(res.message);
        }
      });
    },
    onShareQr: (track) => {
      openQrModal(track);
    },
    onDownload: (track) => {
      downloadSingleTrack(track);
    },
    onDeleteDownload: (track) => {
      deleteDownloadedTrack(track);
    },
    onOpenSongMenu: (track, index, options) => {
      openSongMenuSheet(track, options);
    }
  });
}

/* ======================================================
   CONTROL DE REPRODUCCIÓN Y REPRODUCTOR
====================================================== */
function initPlayerControls() {
  const playerBar = document.getElementById('playerBar');
  const fullscreenPlayer = document.getElementById('fullscreenPlayer');
  const btnCloseFs = document.getElementById('btnFsClose');
  const btnFsQueue = document.getElementById('btnFsQueue');
  const queueDrawer = document.getElementById('queueDrawer');
  const btnCloseQueue = document.getElementById('btnCloseQueue');
  const btnClearQueue = document.getElementById('btnClearQueue');

  // Abrir reproductor fullscreen al tocar la barra flotante
  document.getElementById('playerBarInfoClick')?.addEventListener('click', () => {
    fullscreenPlayer.classList.add('open');
  });

  // Cerrar fullscreen
  btnCloseFs?.addEventListener('click', () => {
    fullscreenPlayer.classList.remove('open');
    queueDrawer?.classList.remove('open');
  });

  // Controles de Barra Dock
  document.getElementById('btnBarPlay')?.addEventListener('click', () => handleTogglePlay());
  document.getElementById('btnBarNext')?.addEventListener('click', () => playNextTrack(false));
  document.getElementById('btnBarPrev')?.addEventListener('click', () => playPrevTrack());
  document.getElementById('btnBarShuffle')?.addEventListener('click', () => toggleShuffle());
  document.getElementById('btnBarRepeat')?.addEventListener('click', () => toggleRepeat());

  // Controles de Fullscreen
  document.getElementById('btnFsPlay')?.addEventListener('click', () => handleTogglePlay());
  document.getElementById('btnFsNext')?.addEventListener('click', () => playNextTrack(false));
  document.getElementById('btnFsPrev')?.addEventListener('click', () => playPrevTrack());
  document.getElementById('btnFsShuffle')?.addEventListener('click', () => toggleShuffle());
  document.getElementById('btnFsRepeat')?.addEventListener('click', () => toggleRepeat());
  document.getElementById('btnFsFav')?.addEventListener('click', () => {
    const track = queueManager.getCurrentTrack();
    if (track) {
      const isFav = playlistManager.toggleFavorite(track);
      updateFsFavButton();
      uiManager.showToast(isFav ? `❤️ Añadida a Favoritas` : `💔 Eliminada de Favoritas`);
    }
  });

  // Salto rápido al hacer clic en la mini barra de progreso del dock
  const barProgressWrapper = document.getElementById('playerBarProgressWrapper');
  barProgressWrapper?.addEventListener('click', (e) => {
    const rect = barProgressWrapper.getBoundingClientRect();
    if (rect.width > 0) {
      const clickX = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
      audioEngine.seekPercentage(percent);
    }
  });

  // Scrubber / Barra de Progreso Fullscreen con Tooltip interactivo
  const slider = document.getElementById('fsProgressSlider');
  const sliderTooltip = document.getElementById('fsSliderTooltip');
  const sliderWrapper = slider?.parentElement;

  slider?.addEventListener('input', (e) => {
    isUserDraggingSlider = true;
    const val = parseFloat(e.target.value);
    slider.style.setProperty('--progress', `${val}%`);
    const duration = audioEngine.getDuration();
    if (duration > 0) {
      const previewSec = (val / 100) * duration;
      const curTimeEl = document.getElementById('fsTimeCurrent');
      if (curTimeEl) curTimeEl.innerText = formatTimeSeconds(previewSec);
    }
  });

  slider?.addEventListener('change', (e) => {
    isUserDraggingSlider = false;
    audioEngine.seekPercentage(parseFloat(e.target.value));
  });

  // Tooltip interactivo al pasar el cursor sobre la barra de progreso
  sliderWrapper?.addEventListener('mousemove', (e) => {
    const rect = sliderWrapper.getBoundingClientRect();
    const duration = audioEngine.getDuration();
    if (duration > 0 && sliderTooltip) {
      const offsetX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const hoverPercent = offsetX / rect.width;
      const hoverTime = hoverPercent * duration;
      sliderTooltip.innerText = formatTimeSeconds(hoverTime);
      sliderTooltip.style.left = `${offsetX}px`;
      sliderTooltip.classList.add('visible');
    }
  });

  sliderWrapper?.addEventListener('mouseleave', () => {
    sliderTooltip?.classList.remove('visible');
  });

  window.addEventListener('mouseup', () => {
    if (isUserDraggingSlider) isUserDraggingSlider = false;
  });
  window.addEventListener('touchend', () => {
    if (isUserDraggingSlider) isUserDraggingSlider = false;
  });

  // Control de Volumen
  const volSlider = document.getElementById('fsVolumeSlider');
  const volIcon = document.getElementById('btnFsVolumeIcon');

  volSlider?.addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    audioEngine.setVolume(vol);
    updateVolumeUI(vol);
  });

  volIcon?.addEventListener('click', () => {
    if (audioEngine.getVolume() > 0) {
      previousVolume = audioEngine.getVolume();
      audioEngine.setVolume(0);
      updateVolumeUI(0);
    } else {
      const restore = previousVolume > 0 ? previousVolume : 0.8;
      audioEngine.setVolume(restore);
      updateVolumeUI(restore);
    }
  });

  // Drawer de Cola
  btnFsQueue?.addEventListener('click', () => {
    queueDrawer.classList.add('open');
    renderQueueDrawer();
  });

  btnCloseQueue?.addEventListener('click', () => {
    queueDrawer.classList.remove('open');
  });

  btnClearQueue?.addEventListener('click', () => {
    queueManager.clear();
    renderQueueDrawer();
    uiManager.showToast('Cola de reproducción vaciada');
  });
}

async function handleTogglePlay() {
  if (audioEngine.hasSource()) {
    audioEngine.togglePlay();
  } else {
    await playCurrentTrack();
  }
}

async function playCurrentTrack() {
  const track = queueManager.getCurrentTrack();
  if (!track) return;

  syncTrackMetadataUI(track);
  document.getElementById('playerBar')?.classList.remove('hidden');

  const ok = await audioEngine.loadAndPlay(track);
  if (ok) {
    syncTrackMetadataUI(track);
    savePlaybackState();
    updateFsFavButton();
  }
}

function playNextTrack(isAutoEnded = false) {
  const nextTrack = queueManager.next(isAutoEnded);
  if (nextTrack) {
    playCurrentTrack();
  } else {
    uiManager.showToast('Fin de la cola de reproducción.');
  }
}

function playPrevTrack() {
  // Si la canción lleva más de 3 segundos, retroceder la reinicia
  if (audioEngine.getCurrentTime() > 3) {
    audioEngine.seek(0);
    return;
  }
  const prevTrack = queueManager.prev();
  if (prevTrack) {
    playCurrentTrack();
  }
}

function toggleShuffle() {
  const active = queueManager.toggleShuffle();
  const btnBar = document.getElementById('btnBarShuffle');
  const btnFs = document.getElementById('btnFsShuffle');
  const btnMini = document.getElementById('miniBtnShuffle');

  if (active) {
    btnBar?.classList.add('active');
    btnFs?.classList.add('active');
    btnMini?.classList.add('active');
    uiManager.showToast('Modo Aleatorio: [ON] 🔀');
  } else {
    btnBar?.classList.remove('active');
    btnFs?.classList.remove('active');
    btnMini?.classList.remove('active');
    uiManager.showToast('Modo Aleatorio: [OFF]');
  }
  savePlaybackState();
}

function syncTrackMetadataUI(track) {
  if (!track) return;
  const isOffline = isTrackDownloaded(track) || track.tipo === 'offline';
  const title = track.titulo || track.title || 'Música';
  const artist = track.channel || (isOffline ? 'AURA Offline 💾' : 'AURA Streaming');
  const thumb = track.thumbnail || '/icon.png';

  // Barra de Título Cyberpunk (Electron)
  const titlebarTrack = document.getElementById('titlebarTrackInfo');
  if (titlebarTrack) {
    titlebarTrack.innerText = `${title} • ${artist}`;
    titlebarTrack.classList.add('is-playing');
  }

  // Barra flotante
  updateMarqueeTitle('playerBarTitleTrack', title, 'playerBarTitle', 'player-bar-title');
  const barArtist = document.getElementById('playerBarArtist');
  if (barArtist) {
    barArtist.innerText = artist;
    barArtist.style.color = isOffline ? 'var(--neon-emerald)' : '';
  }
  const barThumb = document.getElementById('playerBarThumb');
  if (barThumb) barThumb.src = thumb;

  // Fullscreen
  updateMarqueeTitle('fsTrackTitleTrack', title, 'fsTrackTitle', 'fs-track-title');
  const fsArtist = document.getElementById('fsTrackArtist');
  if (fsArtist) {
    fsArtist.innerText = artist;
    fsArtist.style.color = isOffline ? 'var(--neon-emerald)' : '';
  }
  const fsVinyl = document.getElementById('fsVinylImg');
  if (fsVinyl) fsVinyl.src = thumb;

  // Mini-Player Flotante (Widget PiP)
  updateMarqueeTitle('miniTitleTrack', title, 'miniTitle', 'mini-title');
  const miniArtist = document.getElementById('miniArtist');
  if (miniArtist) {
    miniArtist.innerText = artist;
    miniArtist.style.color = isOffline ? 'var(--neon-emerald)' : '';
  }
  const miniCover = document.getElementById('miniCover');
  if (miniCover) miniCover.src = thumb;

  updateFsFavButton();

  // Car Mode
  if (carModeManager) carModeManager.update();
}

const activeMarqueeAnims = new WeakMap();

function updateMarqueeTitle(trackContainerId, titleText, titleElId, cssClass = '') {
  const trackEl = document.getElementById(trackContainerId);
  if (!trackEl) return;
  const wrapperEl = trackEl.closest('.marquee-wrapper') || trackEl.parentElement;
  if (!wrapperEl) return;

  // Cancelar animación previa en este track si existía
  const prevAnim = activeMarqueeAnims.get(trackEl);
  if (prevAnim) {
    try { prevAnim.cancel(); } catch (e) {}
    activeMarqueeAnims.delete(trackEl);
  }

  trackEl.style.transform = 'translateX(0px)';
  trackEl.innerHTML = '';

  // Conservar siempre el ID del elemento principal para que la UI nunca pierda la referencia
  const mainTitle = document.createElement('span');
  mainTitle.id = titleElId;
  mainTitle.className = `marquee-text ${cssClass}`.trim();
  mainTitle.innerText = titleText || 'AURA Music';
  trackEl.appendChild(mainTitle);

  requestAnimationFrame(() => {
    const textWidth = mainTitle.offsetWidth;
    const containerWidth = wrapperEl.clientWidth;

    // Solo animar si el texto desborda el ancho visible
    if (textWidth > containerWidth + 4) {
      const spacer = document.createElement('span');
      spacer.className = 'marquee-spacer';

      const cloneTitle = document.createElement('span');
      cloneTitle.className = `marquee-text ${cssClass}`.trim();
      cloneTitle.innerText = titleText || 'AURA Music';

      trackEl.appendChild(spacer);
      trackEl.appendChild(cloneTitle);

      const loopDistance = textWidth + 48; // Distancia exacta del bucle (ancho + separación de 48px)
      const scrollSpeedPxPerSec = 30; // Velocidad de lectura suave
      const scrollDurationMs = (loopDistance / scrollSpeedPxPerSec) * 1000;
      const pauseDurationMs = 4500; // Pausa inicial de 4.5 segundos en posición inicial
      const totalDurationMs = pauseDurationMs + scrollDurationMs;
      const pauseFraction = pauseDurationMs / totalDurationMs;

      // Animación continua y secuencial: 4.5s de pausa inicial, scroll suave hacia la izquierda y bucle sin saltos
      const anim = trackEl.animate(
        [
          { transform: 'translateX(0px)', offset: 0 },
          { transform: 'translateX(0px)', offset: pauseFraction },
          { transform: `translateX(-${loopDistance}px)`, offset: 1 }
        ],
        {
          duration: totalDurationMs,
          iterations: Infinity,
          easing: 'linear'
        }
      );

      activeMarqueeAnims.set(trackEl, anim);
    }
  });
}

function updatePlayPauseIcons(isPaused) {
  const barPlay = document.getElementById('btnBarPlay');
  const fsPlay = document.getElementById('btnFsPlay');
  const miniPlay = document.getElementById('miniBtnPlay');
  const miniCoverWrap = document.getElementById('miniCoverWrapper');

  const icon = isPaused ? '<i class="ph-fill ph-play"></i>' : '<i class="ph-fill ph-pause"></i>';
  if (barPlay) barPlay.innerHTML = icon;
  if (fsPlay) fsPlay.innerHTML = icon;
  if (miniPlay) miniPlay.innerHTML = icon;

  if (miniCoverWrap) {
    if (isPaused) {
      miniCoverWrap.classList.remove('is-playing');
    } else {
      miniCoverWrap.classList.add('is-playing');
    }
  }

  const titlebarTrack = document.getElementById('titlebarTrackInfo');
  if (titlebarTrack) {
    if (isPaused) {
      titlebarTrack.classList.remove('is-playing');
    } else {
      titlebarTrack.classList.add('is-playing');
    }
  }
}

function updateProgressDisplay(currentTime, duration) {
  if (isNaN(duration) || duration <= 0) return;

  const percent = Math.min(100, Math.max(0, (currentTime / duration) * 100));

  // Mini barra en el borde superior del dock
  const barFill = document.getElementById('playerBarFill');
  if (barFill) barFill.style.width = `${percent}%`;

  // Barra de progreso del Mini-Player Flotante
  const miniFill = document.getElementById('miniProgressBarFill');
  if (miniFill) miniFill.style.width = `${percent}%`;

  const miniCurTime = document.getElementById('miniTimeCurrent');
  const miniTotTime = document.getElementById('miniTimeTotal');
  if (miniCurTime) miniCurTime.innerText = formatTimeSeconds(currentTime);
  if (miniTotTime) miniTotTime.innerText = formatTimeSeconds(duration);

  // Slider en fullscreen (sólo actualiza si el usuario no está arrastrando la barra)
  const slider = document.getElementById('fsProgressSlider');
  if (slider && !isUserDraggingSlider) {
    slider.value = percent;
    slider.style.setProperty('--progress', `${percent}%`);
  }

  // Tiempos formateados
  const curTimeEl = document.getElementById('fsTimeCurrent');
  const totTimeEl = document.getElementById('fsTimeTotal');
  if (curTimeEl && !isUserDraggingSlider) curTimeEl.innerText = formatTimeSeconds(currentTime);
  if (totTimeEl) totTimeEl.innerText = formatTimeSeconds(duration);
}

function updateFsFavButton() {
  const track = queueManager.getCurrentTrack();
  const btnFav = document.getElementById('btnFsFav');
  const miniFav = document.getElementById('miniBtnFav');
  if (!track) return;

  const isFav = playlistManager.isFavorite(track);
  if (btnFav) {
    if (isFav) {
      btnFav.classList.add('active');
      btnFav.style.color = '#ff3366';
      btnFav.innerHTML = '<i class="ph-fill ph-heart"></i>';
    } else {
      btnFav.classList.remove('active');
      btnFav.style.color = '';
      btnFav.innerHTML = '<i class="ph-bold ph-heart"></i>';
    }
  }

  if (miniFav) {
    if (isFav) {
      miniFav.classList.add('is-fav');
      miniFav.innerHTML = '<i class="ph-fill ph-heart"></i>';
    } else {
      miniFav.classList.remove('is-fav');
      miniFav.innerHTML = '<i class="ph-bold ph-heart"></i>';
    }
  }
}

function formatTimeSeconds(sec) {
  if (isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function renderQueueDrawer() {
  uiManager.renderQueueList(
    queueManager.getQueue(),
    queueManager.getCurrentIndex(),
    (index) => {
      queueManager.jumpTo(index);
      playCurrentTrack();
      renderQueueDrawer();
    },
    (index) => {
      queueManager.removeTrack(index);
      renderQueueDrawer();
    },
    (fromIdx, toIdx) => {
      queueManager.reorder(fromIdx, toIdx);
      renderQueueDrawer();
      savePlaybackState();
      uiManager.showToast('Cola de reproducción reordenada');
    }
  );
}

function savePlaybackState() {
  saveStoredData({
    ultimaCola: queueManager.getQueue(),
    ultimoIndice: queueManager.getCurrentIndex(),
    ultimoModoAleatorio: queueManager.isShuffleActive(),
    ultimoPool: queueManager.shufflePool,
    ultimoCursor: queueManager.shuffleCursor
  });
}

/* ======================================================
   GESTIÓN DE PLAYLISTS
====================================================== */
function initPlaylists() {
  // Crear nueva playlist desde biblioteca
  const inputPl = document.getElementById('inputNuevaPlaylist');
  const btnCreatePl = document.getElementById('btnCrearPlaylist');

  btnCreatePl?.addEventListener('click', () => {
    const name = inputPl.value.trim();
    if (!name) return;
    const res = playlistManager.createPlaylist(name);
    if (res.success) {
      inputPl.value = '';
      uiManager.renderPlaylists(playlistManager.getPlaylists(), (n, t) => openPlaylistDetail(n, t));
      uiManager.showToast(`Playlist "${name}" creada exitosamente 📁`);
    } else {
      uiManager.showToast(res.message);
    }
  });

  // Crear playlist rápido dentro del modal
  const modalInputPl = document.getElementById('inputModalNewPlaylist');
  const modalBtnCreate = document.getElementById('btnModalCreatePlaylist');

  const handleCreateInModal = () => {
    const name = modalInputPl?.value.trim();
    if (!name) return;
    const res = playlistManager.createPlaylist(name);
    if (res.success) {
      modalInputPl.value = '';
      uiManager.showToast(`Playlist "${name}" creada exitosamente 📁`);
      uiManager.renderModalPlaylistItems(playlistManager.getPlaylists(), uiManager.modalPlaylistsCallback);
      uiManager.renderPlaylists(playlistManager.getPlaylists(), (n, t) => openPlaylistDetail(n, t));
    } else {
      uiManager.showToast(res.message);
    }
  };

  modalBtnCreate?.addEventListener('click', handleCreateInModal);
  modalInputPl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleCreateInModal();
  });

  // Filtro de playlists en el modal
  const modalFilter = document.getElementById('inputModalFilterPlaylists');
  modalFilter?.addEventListener('input', (e) => {
    uiManager.renderModalPlaylistItems(
      playlistManager.getPlaylists(),
      uiManager.modalPlaylistsCallback,
      e.target.value.trim()
    );
  });

  // Modal cerrar y Listo
  document.getElementById('btnCloseModalAddPl')?.addEventListener('click', () => {
    uiManager.closeModal(document.getElementById('modalAddToPlaylist'));
  });
  document.getElementById('btnModalDoneAddPl')?.addEventListener('click', () => {
    uiManager.closeModal(document.getElementById('modalAddToPlaylist'));
  });
}

function updateRepeatUI(mode) {
  const btnBar = document.getElementById('btnBarRepeat');
  const btnFs = document.getElementById('btnFsRepeat');
  const btnMini = document.getElementById('miniBtnRepeat');

  const applyMode = (btn) => {
    if (!btn) return;
    btn.classList.remove('active', 'repeat-one');
    btn.style.color = '';
    btn.style.background = '';

    if (mode === 'off') {
      btn.innerHTML = '<i class="ph-bold ph-repeat"></i>';
      btn.title = 'Repetir: [OFF]';
    } else if (mode === 'all') {
      btn.classList.add('active');
      btn.innerHTML = '<i class="ph-bold ph-repeat"></i>';
      btn.title = 'Repetir: [Toda la cola] 🔁';
    } else if (mode === 'one') {
      btn.classList.add('active', 'repeat-one');
      btn.innerHTML = '<i class="ph-bold ph-repeat-once"></i>';
      btn.title = 'Repetir: [Una canción] 🔂';
    }
  };

  applyMode(btnBar);
  applyMode(btnFs);
  applyMode(btnMini);
}

function toggleRepeat() {
  const newMode = queueManager.toggleRepeat();
  updateRepeatUI(newMode);
  if (newMode === 'off') {
    uiManager.showToast('Repetición: Desactivada');
  } else if (newMode === 'all') {
    uiManager.showToast('Repetición: Toda la cola 🔁');
  } else {
    uiManager.showToast('Repetición: Una canción 🔂');
  }
}

function updateVolumeUI(volume) {
  const volSlider = document.getElementById('fsVolumeSlider');
  const volIcon = document.getElementById('btnFsVolumeIcon');

  if (volSlider) {
    volSlider.value = volume;
    volSlider.style.setProperty('--vol', `${volume * 100}%`);
  }
  if (volIcon) {
    if (volume === 0) {
      volIcon.className = 'ph-bold ph-speaker-slash btn-volume-icon';
      volIcon.style.color = 'var(--neon-red)';
      volIcon.title = 'Activar sonido (M)';
    } else if (volume < 0.5) {
      volIcon.className = 'ph-bold ph-speaker-low btn-volume-icon';
      volIcon.style.color = 'var(--neon-cyan)';
      volIcon.title = 'Silenciar (M)';
    } else {
      volIcon.className = 'ph-bold ph-speaker-high btn-volume-icon';
      volIcon.style.color = 'var(--neon-cyan)';
      volIcon.title = 'Silenciar (M)';
    }
  }
}

function initKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    const tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) {
      return;
    }

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        handleTogglePlay();
        break;
      case 'ArrowRight':
        e.preventDefault();
        audioEngine.seek(Math.min(audioEngine.getDuration(), audioEngine.getCurrentTime() + 5));
        uiManager.showToast('⏩ +5s');
        break;
      case 'ArrowLeft':
        e.preventDefault();
        audioEngine.seek(Math.max(0, audioEngine.getCurrentTime() - 5));
        uiManager.showToast('⏪ -5s');
        break;
      case 'ArrowUp':
        e.preventDefault();
        const vUp = Math.min(1, Math.round((audioEngine.getVolume() + 0.1) * 10) / 10);
        audioEngine.setVolume(vUp);
        updateVolumeUI(vUp);
        uiManager.showToast(`🔊 ${Math.round(vUp * 100)}%`);
        break;
      case 'ArrowDown':
        e.preventDefault();
        const vDown = Math.max(0, Math.round((audioEngine.getVolume() - 0.1) * 10) / 10);
        audioEngine.setVolume(vDown);
        updateVolumeUI(vDown);
        uiManager.showToast(`🔉 ${Math.round(vDown * 100)}%`);
        break;
      case 'KeyM':
        e.preventDefault();
        document.getElementById('btnFsVolumeIcon')?.click();
        break;
      case 'KeyN':
        e.preventDefault();
        playNextTrack(false);
        break;
      case 'KeyP':
        e.preventDefault();
        playPrevTrack();
        break;
      case 'KeyS':
        e.preventDefault();
        toggleShuffle();
        break;
      case 'KeyR':
        e.preventDefault();
        toggleRepeat();
        break;
      case 'KeyF':
        e.preventDefault();
        document.getElementById('fullscreenPlayer')?.classList.toggle('open');
        break;
      case 'Escape':
        document.getElementById('fullscreenPlayer')?.classList.remove('open');
        document.getElementById('queueDrawer')?.classList.remove('open');
        uiManager.closeModal(document.getElementById('modalAddToPlaylist'));
        uiManager.closeModal(document.getElementById('modalShareQr'));
        break;
    }
  });
}

function openPlaylistDetail(playlistName, tracks) {
  currentPlaylistViewName = playlistName;
  document.getElementById('vista-biblioteca')?.classList.remove('view-active');
  const detailView = document.getElementById('vista-playlist-detalle');
  detailView?.classList.add('view-active');

  uiManager.renderPlaylistDetail(playlistName, tracks, {
    onPlayAll: () => {
      if (tracks.length === 0) {
        uiManager.showToast('La playlist no tiene canciones.');
        return;
      }
      queueManager.setQueue(tracks, 0);
      playCurrentTrack();
    },
    onPlayTrack: (track, index) => {
      queueManager.setQueue(tracks, index);
      playCurrentTrack();
    },
    onRemoveTrack: (index) => {
      playlistManager.removeTrack(playlistName, index);
      const updated = playlistManager.getTracks(playlistName);
      openPlaylistDetail(playlistName, updated);
      uiManager.showToast('Canción eliminada de la playlist.');
    },
    onDownloadPlaylist: async (plName, plTracks, btnEl) => {
      await downloadEntirePlaylistDesktop(plName, plTracks, btnEl);
    },
    onShareQr: () => {
      openPlaylistQrModal(playlistName, tracks);
    },
    onDeletePlaylist: () => {
      if (confirm(`¿Estás seguro de eliminar la playlist "${playlistName}"?`)) {
        playlistManager.deletePlaylist(playlistName);
        document.getElementById('btnVolverBiblioteca')?.click();
        uiManager.renderPlaylists(playlistManager.getPlaylists(), (n, t) => openPlaylistDetail(n, t));
        uiManager.showToast(`Playlist "${playlistName}" eliminada.`);
      }
    },
    onDownload: (track) => {
      downloadSingleTrack(track);
    },
    onDeleteDownload: (track) => {
      deleteDownloadedTrack(track);
    },
    onOpenSongMenu: (track, index, options) => {
      openSongMenuSheet(track, options);
    },
    onOpenPlaylistMenu: (plName, plTracks) => {
      uiManager.openPlaylistActionSheet(plName, plTracks, {
        onDownloadPlaylist: (name, trks) => {
          downloadEntirePlaylistDesktop(name, trks, null);
        },
        onDeleteDownloadedTracks: (trks, name) => {
          deleteDownloadedTracksFromPlaylist(trks, name);
        },
        onShareQr: () => {
          openPlaylistQrModal(plName, plTracks);
        },
        onDeletePlaylist: () => {
          if (confirm(`¿Estás seguro de eliminar la playlist "${plName}"?`)) {
            playlistManager.deletePlaylist(plName);
            document.getElementById('btnVolverBiblioteca')?.click();
            uiManager.renderPlaylists(playlistManager.getPlaylists(), (n, t) => openPlaylistDetail(n, t));
            uiManager.showToast(`Playlist "${plName}" eliminada.`);
          }
        }
      });
    },
    onRefreshOffline: async () => {
      if (window.auraDesktop) {
        uiManager.showToast('Actualizando archivos locales... 🔄');
        const updated = await window.auraDesktop.obtenerMusicaLocal();
        openPlaylistDetail('__offline__', updated);
      }
    },
    onDeleteOfflineTrack: async (track, index) => {
      if (!window.auraDesktop) return;
      const title = track.titulo || track.title;
      if (confirm(`¿Eliminar el archivo "${title}.mp3" del disco?`)) {
        const ok = await window.auraDesktop.eliminarArchivo(title);
        if (ok) {
          uiManager.showToast(`Archivo "${title}.mp3" eliminado del disco 🗑️`);
          const updated = await window.auraDesktop.obtenerMusicaLocal();
          openPlaylistDetail('__offline__', updated);
          // Actualizar tamaño en ajustes
          window.auraDesktop.obtenerTamanioCarpeta().then((stats) => {
            const lblSize = document.getElementById('lblDesktopFolderSize');
            if (lblSize) lblSize.innerText = `${stats.formateado} descargados`;
          });
        } else {
          uiManager.showToast('No se pudo eliminar el archivo.');
        }
      }
    }
  });
}

/* ======================================================
   TRANSFERENCIA QR Y MODALES
====================================================== */
function initQrModals() {
  document.getElementById('btnCloseModalShareQr')?.addEventListener('click', () => {
    uiManager.closeModal(document.getElementById('modalShareQr'));
  });

  // Botón iniciar cámara
  document.getElementById('btnAbrirEscanerCamara')?.addEventListener('click', async () => {
    const container = document.getElementById('lector-camara-container');
    container.classList.remove('hidden');

    try {
      await qrService.startCameraScanner('lector-qr-camera', (result) => {
        handleQrPayload(result);
        qrService.stopScanner();
        container.classList.add('hidden');
      });
    } catch (err) {
      uiManager.showToast(`Error al abrir cámara: ${err.message}`);
      container.classList.add('hidden');
    }
  });

  document.getElementById('btnCerrarCamara')?.addEventListener('click', async () => {
    await qrService.stopScanner();
    document.getElementById('lector-camara-container').classList.add('hidden');
  });

  // Escanear archivo de imagen
  const inputScanFile = document.getElementById('inputScanQrFile');
  inputScanFile?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      uiManager.showToast('Analizando código QR de la imagen...');
      await qrService.scanFile(file, (result) => {
        handleQrPayload(result);
      });
    } catch (err) {
      uiManager.showToast(`⚠️ ${err.message}`);
    } finally {
      inputScanFile.value = '';
    }
  });
}

function openQrModal(track) {
  const modal = document.getElementById('modalShareQr');
  const titleEl = document.getElementById('modalShareQrTitle');
  const canvas = document.getElementById('qrCodeCanvas');
  const btnCopy = document.getElementById('btnCopyQrPayload');

  if (titleEl) titleEl.innerText = `Compartir: ${track.titulo || track.title}`;
  const payload = qrService.generateSongPayload(track);
  qrService.generateQr(canvas, payload);

  btnCopy.onclick = () => {
    navigator.clipboard.writeText(track.urlYoutube || track.url);
    uiManager.showToast('Enlace de YouTube copiado al portapapeles 📋');
  };

  modal.classList.add('open');
}

function openPlaylistQrModal(name, tracks) {
  const modal = document.getElementById('modalShareQr');
  const titleEl = document.getElementById('modalShareQrTitle');
  const canvas = document.getElementById('qrCodeCanvas');
  const btnCopy = document.getElementById('btnCopyQrPayload');

  if (titleEl) titleEl.innerText = `QR Playlist: ${name}`;
  const payload = qrService.generatePlaylistPayload(name, tracks);
  qrService.generateQr(canvas, payload);

  btnCopy.onclick = () => {
    navigator.clipboard.writeText(payload);
    uiManager.showToast('Payload de playlist copiado al portapapeles 📋');
  };

  modal.classList.add('open');
}

async function handleQrPayload(result) {
  if (!result.success) {
    uiManager.showToast('Código QR no reconocido.');
    return;
  }

  const { isAura, payload } = result;

  if (payload.type === 'song') {
    uiManager.showToast(`Recibida canción: ${payload.title}`);
    const track = {
      tipo: 'online',
      titulo: payload.title,
      urlYoutube: payload.url,
      thumbnail: payload.thumbnail || `https://img.youtube.com/vi/${payload.vId}/mqdefault.jpg`
    };
    playlistManager.addTrack('Favoritas', track);
    queueManager.addTrack(track);
    queueManager.jumpTo(queueManager.getQueue().length - 1);
    playCurrentTrack();
  } else if (payload.type === 'playlist') {
    uiManager.showToast(`Importando playlist "${payload.name}" desde QR...`);
    const newName = `${payload.name} (QR)`;
    playlistManager.createPlaylist(newName);

    if (Array.isArray(payload.ids)) {
      for (const id of payload.ids) {
        const details = await obtenerDetallesVideo(id);
        if (details) {
          playlistManager.addTrack(newName, {
            tipo: 'online',
            titulo: details.title,
            urlYoutube: details.url,
            thumbnail: details.thumbnail,
            duracion: details.duration
          });
        }
      }
      uiManager.showToast(`Playlist "${newName}" importada con éxito.`);
      uiManager.renderPlaylists(playlistManager.getPlaylists(), (n, t) => openPlaylistDetail(n, t));
    }
  } else {
    uiManager.showToast(`Contenido QR: ${payload.raw || 'Procesado'}`);
  }
}

/* ======================================================
   AJUSTES Y UTILIDADES (IMPORTACIONES Y BACKUPS)
====================================================== */
function initSettings() {
  // 1. Importar desde YouTube por URL
  const inputImport = document.getElementById('inputImportarUrl');
  const btnImport = document.getElementById('btnImportarUrl');

  btnImport?.addEventListener('click', async () => {
    const url = inputImport.value.trim();
    if (!url) return;

    const playlistId = extraerPlaylistId(url);
    const videoId = extraerVideoId(url);

    if (playlistId) {
      uiManager.showToast('Escaneando playlist de YouTube... ⏳');
      try {
        const name = await obtenerNombrePlaylist(playlistId);
        const tracks = await obtenerVideosDePlaylist(playlistId);

        if (tracks.length === 0) {
          uiManager.showToast('La playlist de YouTube no contiene canciones públicas.');
          return;
        }

        playlistManager.createPlaylist(name);
        tracks.forEach((t) => playlistManager.addTrack(name, t));
        uiManager.showToast(`Playlist "${name}" importada (${tracks.length} canciones).`);
        inputImport.value = '';
        uiManager.renderPlaylists(playlistManager.getPlaylists(), (n, t) => openPlaylistDetail(n, t));
      } catch (err) {
        uiManager.showToast(`Error al importar playlist: ${err.message}`);
      }
    } else if (videoId) {
      uiManager.showToast('Obteniendo detalles del video... ⏳');
      try {
        const details = await obtenerDetallesVideo(videoId);
        if (details) {
          playlistManager.addTrack('Favoritas', {
            tipo: 'online',
            titulo: details.title,
            urlYoutube: details.url,
            thumbnail: details.thumbnail,
            duracion: details.duration,
            channel: details.channel
          });
          uiManager.showToast(`Canción "${details.title}" añadida a Favoritas ❤️`);
          inputImport.value = '';
        } else {
          uiManager.showToast('No se encontró el video.');
        }
      } catch (err) {
        uiManager.showToast(`Error: ${err.message}`);
      }
    } else {
      uiManager.showToast('URL de YouTube no válida.');
    }
  });

  // 2. Exportar Respaldo JSON
  document.getElementById('btnExportarBackup')?.addEventListener('click', () => {
    const ok = exportBackupFile();
    if (ok) {
      uiManager.showToast('Respaldo descargado como archivo JSON 💾');
    } else {
      uiManager.showToast('Error al exportar respaldo.');
    }
  });

  // 3. Importar Respaldo JSON
  const fileBackup = document.getElementById('inputImportarBackup');
  fileBackup?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = importBackupJson(event.target.result, 'fusionar');
      if (result.success) {
        playlistManager.init();
        uiManager.renderPlaylists(playlistManager.getPlaylists(), (n, t) => openPlaylistDetail(n, t));
        uiManager.showToast(`Respaldo importado con éxito (${result.count} playlists).`);
      } else {
        uiManager.showToast(`Error al importar: ${result.error}`);
      }
      fileBackup.value = '';
    };
    reader.readAsText(file);
  });

  // 4. Gestión de RapidAPI Keys
  const inputNewRapid = document.getElementById('inputNewRapidKey');
  const btnAddRapid = document.getElementById('btnAddRapidKey');
  const btnResetRapid = document.getElementById('btnResetRapidKeys');

  btnAddRapid?.addEventListener('click', () => {
    const k = inputNewRapid.value.trim();
    if (!k) return;
    const added = addRapidApiKey(k);
    if (added) {
      inputNewRapid.value = '';
      uiManager.renderRapidKeysList(getRapidApiKeys(), (idx) => removeKeyAt(idx));
      uiManager.showToast('Llave RapidAPI agregada.');
    } else {
      uiManager.showToast('La llave ya existe o no es válida.');
    }
  });

  btnResetRapid?.addEventListener('click', () => {
    if (confirm('¿Restaurar las llaves por defecto de RapidAPI?')) {
      resetRapidApiKeys();
      uiManager.renderRapidKeysList(getRapidApiKeys(), (idx) => removeKeyAt(idx));
      uiManager.showToast('Llaves RapidAPI restauradas.');
    }
  });

  function removeKeyAt(idx) {
    removeRapidApiKey(idx);
    uiManager.renderRapidKeysList(getRapidApiKeys(), (i) => removeKeyAt(i));
    uiManager.showToast('Llave eliminada.');
  }

  // 5. Gestión de YouTube Key
  const inputYt = document.getElementById('inputYoutubeKey');
  const btnSaveYt = document.getElementById('btnSaveYoutubeKey');
  const btnResetYt = document.getElementById('btnResetYoutubeKey');

  btnSaveYt?.addEventListener('click', () => {
    const k = inputYt.value.trim();
    if (!k) return;
    setYoutubeApiKey(k);
    uiManager.showToast('Llave de YouTube guardada exitosamente.');
  });

  btnResetYt?.addEventListener('click', () => {
    if (confirm('¿Restaurar llave de YouTube por defecto?')) {
      resetYoutubeApiKey();
      inputYt.value = getYoutubeApiKey();
      uiManager.showToast('Llave de YouTube restaurada.');
    }
  });

  // 6. Controles de Carpeta Offline Desktop (Exclusivo Electron)
  if (window.auraDesktop) {
    const lblPath = document.getElementById('lblDesktopDownloadPath');
    const lblSize = document.getElementById('lblDesktopFolderSize');
    const btnChange = document.getElementById('btnDesktopChangeFolder');
    const btnOpen = document.getElementById('btnDesktopOpenFolder');

    const updateFolderDisplay = async () => {
      try {
        const folder = await window.auraDesktop.obtenerCarpeta();
        if (lblPath) lblPath.innerText = folder;
        const stats = await window.auraDesktop.obtenerTamanioCarpeta();
        if (lblSize) lblSize.innerText = `${stats.formateado} descargados`;
      } catch (e) {
        console.warn('Error leyendo carpeta desktop:', e);
      }
    };

    updateFolderDisplay();

    btnChange?.addEventListener('click', async () => {
      const selected = await window.auraDesktop.seleccionarCarpeta();
      if (selected && lblPath) {
        lblPath.innerText = selected;
        uiManager.showToast('Carpeta de descargas actualizada 📁');
        updateFolderDisplay();
      }
    });

    btnOpen?.addEventListener('click', () => {
      window.auraDesktop.abrirCarpeta();
    });
  }
}

/* ======================================================
   FUNCIONES EXCLUSIVAS DESKTOP (AURA ELECTRON)
====================================================== */
function initDesktopTitlebar() {
  if (!window.auraDesktop) return;

  const btnMin = document.getElementById('btnTitlebarMin');
  const btnMax = document.getElementById('btnTitlebarMax');
  const btnClose = document.getElementById('btnTitlebarClose');
  const btnMini = document.getElementById('btnTitlebarMini');
  const iconMax = document.getElementById('iconTitlebarMax');
  let isMiniActive = false;

  const setMiniMode = async (activar) => {
    isMiniActive = Boolean(activar);
    await window.auraDesktop.toggleMiniPlayer(isMiniActive);
    document.body.classList.toggle('mini-player-active', isMiniActive);
    btnMini?.classList.toggle('active', isMiniActive);
    if (btnMini) {
      btnMini.innerHTML = isMiniActive
        ? '<i class="ph-bold ph-corners-out"></i>'
        : '<i class="ph-bold ph-picture-in-picture"></i>';
      btnMini.title = isMiniActive ? 'Restaurar ventana completa' : 'Modo Mini-Player Flotante';
    }

    if (isMiniActive) {
      const track = queueManager.getCurrentTrack();
      if (track) syncTrackMetadataUI(track);
      updatePlayPauseIcons(audioEngine.isPaused());
      updateProgressDisplay(audioEngine.getCurrentTime(), audioEngine.getDuration());
    }
  };

  btnMin?.addEventListener('click', () => window.auraDesktop.minimize());
  btnMax?.addEventListener('click', async () => {
    const isMax = await window.auraDesktop.maximize();
    if (iconMax) {
      iconMax.className = isMax ? 'ph-bold ph-corners-in' : 'ph-bold ph-square';
    }
  });
  btnClose?.addEventListener('click', () => window.auraDesktop.close());

  btnMini?.addEventListener('click', () => setMiniMode(!isMiniActive));

  // Controles del Mini-Player Flotante
  document.getElementById('miniBtnRestore')?.addEventListener('click', () => setMiniMode(false));
  document.getElementById('miniBtnPlay')?.addEventListener('click', () => handleTogglePlay());
  document.getElementById('miniBtnNext')?.addEventListener('click', () => playNextTrack(false));
  document.getElementById('miniBtnPrev')?.addEventListener('click', () => playPrevTrack());
  document.getElementById('miniBtnShuffle')?.addEventListener('click', () => toggleShuffle());
  document.getElementById('miniBtnRepeat')?.addEventListener('click', () => toggleRepeat());
  document.getElementById('miniBtnFav')?.addEventListener('click', () => {
    const track = queueManager.getCurrentTrack();
    if (track) {
      const isFav = playlistManager.toggleFavorite(track);
      updateFsFavButton();
      uiManager.showToast(isFav ? '❤️ Añadida a Favoritas' : '💔 Eliminada de Favoritas');
    }
  });

  // Salto de tiempo interactivo en barra de progreso del mini-player
  const miniBarWrapper = document.getElementById('miniProgressBarWrapper');
  miniBarWrapper?.addEventListener('click', (e) => {
    const rect = miniBarWrapper.getBoundingClientRect();
    if (rect.width > 0) {
      const clickX = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
      audioEngine.seekPercentage(percent);
    }
  });

  window.auraDesktop.onWindowStateChange?.(({ isMaximized }) => {
    if (iconMax) {
      iconMax.className = isMaximized ? 'ph-bold ph-corners-in' : 'ph-bold ph-square';
    }
  });

  window.auraDesktop.onMediaAction?.((action) => {
    if (action === 'togglePlay') handleTogglePlay();
    else if (action === 'next') playNextTrack(false);
    else if (action === 'prev') playPrevTrack();
  });
}

async function downloadTrackOffline(track, btnEl) {
  if (!window.auraDesktop) {
    uiManager.showToast('Descarga disponible solo en AURA Desktop');
    return;
  }

  const originalHtml = btnEl.innerHTML;
  btnEl.innerHTML = '<i class="ph-bold ph-spinner" style="animation: spinVinyl 1s linear infinite; display: inline-block;"></i>';
  btnEl.disabled = true;

  const title = track.title || track.titulo || 'Pista';
  const url = track.urlYoutube || track.url;
  uiManager.showToast(`Descargando "${title}" en MP3... ⏳`);

  try {
    const res = await window.auraDesktop.descargarMusica({ url, titulo: title });
    if (res && res.exito) {
      uiManager.showToast(`🎵 "${title}" guardado en tu carpeta offline.`);
      btnEl.innerHTML = '<i class="ph-fill ph-check-circle" style="color: var(--neon-lime);"></i>';
      btnEl.title = 'Descargado en disco';

      // Actualizar contador en biblioteca si está visible
      window.auraDesktop.obtenerMusicaLocal().then((locales) => {
        const countEl = document.getElementById('cardOfflineCount');
        if (countEl) countEl.innerText = `${locales.length} archivo${locales.length === 1 ? '' : 's'} MP3`;
      }).catch(() => {});

      // Actualizar tamaño de carpeta en ajustes
      window.auraDesktop.obtenerTamanioCarpeta().then((stats) => {
        const lblSize = document.getElementById('lblDesktopFolderSize');
        if (lblSize) lblSize.innerText = `${stats.formateado} descargados`;
      }).catch(() => {});
    } else {
      uiManager.showToast(`⚠️ Error al descargar: ${res?.error || 'Fallo desconocido'}`);
      btnEl.innerHTML = originalHtml;
    }
  } catch (err) {
    uiManager.showToast(`⚠️ Error: ${err.message}`);
    btnEl.innerHTML = originalHtml;
  } finally {
    btnEl.disabled = false;
  }
}

/**
 * Descarga por lotes todas las canciones de una playlist en el almacenamiento local de AURA Desktop
 */
async function downloadEntirePlaylistDesktop(playlistName, tracks, btnEl) {
  if (!window.auraDesktop) {
    uiManager.showToast('Descarga por lotes disponible en AURA Desktop.');
    return;
  }

  const onlineTracks = tracks.filter((t) => t.tipo !== 'offline');
  if (onlineTracks.length === 0) {
    uiManager.showToast('Todas las canciones ya están guardadas o no tienen enlace.');
    return;
  }

  const originalHtml = btnEl.innerHTML;
  btnEl.disabled = true;
  uiManager.showToast(`Iniciando descarga de ${onlineTracks.length} canciones de "${playlistName}"... 🚀`);

  let count = 0;
  for (let i = 0; i < onlineTracks.length; i++) {
    const track = onlineTracks[i];
    btnEl.innerHTML = `⏳ ${i + 1}/${onlineTracks.length}`;
    const title = track.titulo || track.title || `Pista_${i + 1}`;
    const url = track.urlYoutube || track.url;

    try {
      if (url) {
        const res = await window.auraDesktop.descargarMusica({
          url,
          titulo: title,
          thumbnail: track.thumbnail
        });
        if (res && res.exito) {
          count++;
        }
      }
    } catch (err) {
      console.warn(`[AURA Desktop] Error descargando "${title}":`, err.message);
    }
  }

  btnEl.disabled = false;
  btnEl.innerHTML = '<i class="ph-fill ph-check-circle" style="color: var(--neon-lime);"></i> <span>Listo</span>';
  uiManager.showToast(`✓ Descarga completada: ${count} de ${onlineTracks.length} canciones guardadas.`);

  // Actualizar stats de offline
  window.auraDesktop.obtenerMusicaLocal().then((locales) => {
    const countEl = document.getElementById('cardOfflineCount');
    if (countEl) countEl.innerText = `${locales.length} archivo${locales.length === 1 ? '' : 's'} MP3`;
  }).catch(() => {});

  setTimeout(() => {
    if (btnEl) btnEl.innerHTML = originalHtml;
  }, 4000);
}

function openSongMenuSheet(track, options = {}) {
  uiManager.openSongActionSheet(track, options, {
    onPlay: (t) => {
      queueManager.addToQueue(t);
      queueManager.jumpTo(queueManager.getQueue().length - 1);
      playCurrentTrack();
    },
    onAddToQueue: (t) => {
      queueManager.addToQueue(t);
      renderQueueDrawer();
      savePlaybackState();
      uiManager.showToast(`"${t.titulo || t.title}" agregada a la cola ➕`);
    },
    onToggleFav: (t) => {
      const isFav = playlistManager.toggleFavorite(t);
      uiManager.showToast(isFav ? `❤️ Añadida a Favoritas` : `💔 Eliminada de Favoritas`);
      updateFsFavButton();
      refreshCurrentTrackListUI();
    },
    onDownload: (t) => {
      downloadSingleTrack(t);
    },
    onDeleteDownload: (t) => {
      deleteDownloadedTrack(t);
    },
    onAddToPlaylist: (t) => {
      uiManager.openAddToPlaylistModal(t, playlistManager.getPlaylists(), (plName, song, itemEl) => {
        const res = playlistManager.addTrack(plName, song);
        if (res.success) {
          uiManager.showToast(`Guardada en "${plName}" ✨`);
          uiManager.renderPlaylists(playlistManager.getPlaylists(), (n, trks) => openPlaylistDetail(n, trks));
        } else {
          uiManager.showToast(res.message);
        }
      });
    },
    onShareQr: (t) => {
      openQrModal(t);
    },
    onRemoveFromPlaylist: (t, index) => {
      if (options.playlistName && typeof index === 'number') {
        playlistManager.removeTrack(options.playlistName, index);
        const updated = playlistManager.getTracks(options.playlistName);
        openPlaylistDetail(options.playlistName, updated);
        uiManager.showToast('Canción eliminada de la playlist.');
      }
    }
  });
}

async function downloadSingleTrack(track) {
  if (!track) return;
  const rawTitle = track.titulo || track.title || 'Pista';
  const url = track.urlYoutube || track.url;

  if (isTrackDownloaded(track)) {
    uiManager.showToast(`"${rawTitle}" ya está descargada en tu equipo 💾`);
    return;
  }

  uiManager.showToast(`Descargando "${rawTitle}" en MP3... ⏳`);

  try {
    if (window.auraDesktop) {
      const res = await window.auraDesktop.descargarMusica({
        url,
        titulo: rawTitle,
        thumbnail: track.thumbnail
      });

      if (res && res.exito) {
        registerDownloadedTrack(track, res.ruta || `file://${rawTitle}.mp3`, res.ruta || null);
        uiManager.showToast(`✓ "${rawTitle}" guardada en disco 📥`);
        refreshCurrentTrackListUI();
      } else {
        throw new Error(res?.error || 'No se pudo descargar');
      }
    } else {
      const streamUrl = await obtenerEnlaceAudio(url);
      const a = document.createElement('a');
      a.href = streamUrl;
      a.download = `${rawTitle}.mp3`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      registerDownloadedTrack(track, streamUrl, streamUrl);
      uiManager.showToast(`✓ Descarga iniciada: ${rawTitle} 📥`);
      refreshCurrentTrackListUI();
    }
  } catch (err) {
    console.error('[Download] Error descargando pista:', err);
    uiManager.showToast(`Error al descargar: ${err.message}`);
  }
}

async function deleteDownloadedTrack(track) {
  if (!track) return;
  const rawTitle = track.titulo || track.title || 'Pista';
  const info = getDownloadedTrackInfo(track);

  if (window.auraDesktop) {
    try {
      await window.auraDesktop.eliminarArchivo(rawTitle);
    } catch (e) {
      console.warn(e);
    }
  }

  unregisterDownloadedTrack(track);
  uiManager.showToast(`Archivo descargado eliminado: ${rawTitle} 🗑️`);
  refreshCurrentTrackListUI();
}

async function deleteDownloadedTracksFromPlaylist(tracks, playlistName) {
  if (!tracks || tracks.length === 0) {
    uiManager.showToast('Esta playlist no contiene canciones.');
    return;
  }

  let count = 0;
  for (const track of tracks) {
    if (isTrackDownloaded(track)) {
      const rawTitle = track.titulo || track.title;
      if (window.auraDesktop && rawTitle) {
        try {
          await window.auraDesktop.eliminarArchivo(rawTitle);
        } catch (e) {}
      }
      unregisterDownloadedTrack(track);
      count++;
    }
  }

  if (count > 0) {
    uiManager.showToast(`Se eliminaron ${count} descargas de "${playlistName}" 🗑️`);
    refreshCurrentTrackListUI();
  } else {
    uiManager.showToast(`No había canciones descargadas en "${playlistName}".`);
  }
}

function refreshCurrentTrackListUI() {
  const detailView = document.getElementById('vista-playlist-detalle');
  if (detailView && detailView.classList.contains('view-active') && currentPlaylistViewName) {
    const updated = playlistManager.getTracks(currentPlaylistViewName);
    openPlaylistDetail(currentPlaylistViewName, updated);
  }
  const searchView = document.getElementById('vista-busqueda');
  if (searchView && searchView.classList.contains('view-active') && ultimosResultadosBusqueda && ultimosResultadosBusqueda.length > 0) {
    renderActiveSearchResults(ultimosResultadosBusqueda);
  }
  renderQueueDrawer();
}

function initNetworkDetection() {
  const badge = document.getElementById('badgeNetworkStatus');
  const lbl = document.getElementById('lblNetworkStatus');

  function updateStatus(isOnline, notify = false) {
    if (badge) {
      badge.classList.remove('is-online', 'is-offline');
      badge.classList.add(isOnline ? 'is-online' : 'is-offline');
    }
    if (lbl) {
      lbl.innerText = isOnline ? 'ONLINE' : 'OFFLINE';
    }
    if (notify) {
      if (isOnline) {
        uiManager.showToast('Conexión a internet restablecida ⚡');
      } else {
        uiManager.showToast('Sin conexión a internet. Modo offline activo 📡');
      }
    }
  }

  window.addEventListener('online', () => updateStatus(true, true));
  window.addEventListener('offline', () => updateStatus(false, true));
  updateStatus(navigator.onLine, false);
}

