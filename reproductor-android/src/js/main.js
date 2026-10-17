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
import { App } from '@capacitor/app';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { obtenerEnlaceAudio } from './api.js';

// Estado en memoria
let busquedasRecientes = [];
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
  initNavigation();
  initSearch();
  initPlaylists();
  initPlayerControls();
  initSettings();
  initQrModals();
  initKeyboardShortcuts();
  initAndroidBackButton();
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
      requestNotificationPermission();
    },
    onPause: (track) => {
      updatePlayPauseIcons(true);
      document.getElementById('fsVinylWrapper')?.classList.remove('is-playing');
      carModeManager.update();
    },
    onTimeUpdate: (currentTime, duration) => {
      updateProgressDisplay(currentTime, duration);
    },
    onEnded: () => {
      playNextTrack(true);
    },
    onError: (err) => {
      uiManager.showToast(`⚠️ ${err.message || 'Error al reproducir audio'}`);
      updatePlayPauseIcons(true);
      const current = queueManager.getCurrentTrack();
      if (current) syncTrackMetadataUI(current);
    },
    onLoading: (track) => {
      const title = track.titulo || track.title || 'Música';
      const barTitle = document.getElementById('playerBarTitle');
      if (barTitle) {
        barTitle.innerText = title;
        applyTitleMarquee(barTitle);
      }
      const barArtist = document.getElementById('playerBarArtist');
      if (barArtist) barArtist.innerText = `Conectando audio online... ⏳`;

      const fsTitle = document.getElementById('fsTrackTitle');
      if (fsTitle) {
        fsTitle.innerText = title;
        applyTitleMarquee(fsTitle);
      }
      const fsArtist = document.getElementById('fsTrackArtist');
      if (fsArtist) fsArtist.innerText = `Conectando con AURA Stream... ☁️`;

      uiManager.showToast(`Conectando audio online... ☁️`);
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

  // Solicitar permiso de notificaciones para Android y Desktop
  requestNotificationPermission();

  // Recalcular desplazamiento animado del título si la pantalla rota o cambia de tamaño
  window.addEventListener('resize', () => {
    applyTitleMarquee(document.getElementById('playerBarTitle'));
    applyTitleMarquee(document.getElementById('fsTrackTitle'));
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

  if (active) {
    btnBar?.classList.add('active');
    btnFs?.classList.add('active');
    uiManager.showToast('Modo Aleatorio: [ON] 🔀');
  } else {
    btnBar?.classList.remove('active');
    btnFs?.classList.remove('active');
    uiManager.showToast('Modo Aleatorio: [OFF]');
  }
  savePlaybackState();
}

function syncTrackMetadataUI(track) {
  if (!track) return;
  const title = track.titulo || track.title || 'Música';
  const artist = track.channel || 'AURA Streaming';
  const thumb = track.thumbnail || '/icon.png';

  // Barra flotante
  const barTitle = document.getElementById('playerBarTitle');
  if (barTitle) {
    barTitle.innerText = title;
    applyTitleMarquee(barTitle);
  }
  const barArtist = document.getElementById('playerBarArtist');
  if (barArtist) barArtist.innerText = artist;
  const barThumb = document.getElementById('playerBarThumb');
  if (barThumb) barThumb.src = thumb;

  // Fullscreen
  const fsTitle = document.getElementById('fsTrackTitle');
  if (fsTitle) {
    fsTitle.innerText = title;
    applyTitleMarquee(fsTitle);
  }
  const fsArtist = document.getElementById('fsTrackArtist');
  if (fsArtist) fsArtist.innerText = artist;
  const fsVinyl = document.getElementById('fsVinylImg');
  if (fsVinyl) fsVinyl.src = thumb;

  // Car Mode
  if (carModeManager) carModeManager.update();
}

const activeMarqueeAnims = new WeakMap();

function applyTitleMarquee(element) {
  if (!element) return;
  const trackEl = element.closest('.marquee-track') || element;
  const wrapperEl = trackEl.closest('.marquee-wrapper') || trackEl.parentElement;
  if (!wrapperEl) return;

  // Cancelar animación previa si existía en esta pista
  const prevAnim = activeMarqueeAnims.get(trackEl);
  if (prevAnim) {
    try { prevAnim.cancel(); } catch (e) {}
    activeMarqueeAnims.delete(trackEl);
  }

  // Obtener texto original limpio
  const rawTitle = element.getAttribute('data-raw-title') || element.innerText || 'AURA Music';
  element.setAttribute('data-raw-title', rawTitle);

  // Reconstruir un único span inicial sin duplicados
  trackEl.innerHTML = '';
  const span1 = document.createElement('span');
  span1.className = 'marquee-text';
  span1.innerText = rawTitle;
  trackEl.appendChild(span1);
  trackEl.style.transform = 'translateX(0px)';

  // Medir tras renderizado en el DOM
  requestAnimationFrame(() => {
    const textWidth = span1.offsetWidth;
    const containerWidth = wrapperEl.clientWidth;

    // Solo animar si el texto desborda el ancho visible
    if (textWidth > containerWidth + 4) {
      const spacer = document.createElement('span');
      spacer.className = 'marquee-spacer';

      const span2 = document.createElement('span');
      span2.className = 'marquee-text';
      span2.innerText = rawTitle;

      trackEl.appendChild(spacer);
      trackEl.appendChild(span2);

      const loopDistance = textWidth + 48; // Distancia exacta del bucle (ancho + separación de 48px)
      const scrollSpeedPxPerSec = 30; // Velocidad suave y placentera para leer
      const scrollDurationMs = (loopDistance / scrollSpeedPxPerSec) * 1000;
      const pauseDurationMs = 4500; // Pausa inicial de ~4.5 a 5 segundos en su posición
      const totalDurationMs = pauseDurationMs + scrollDurationMs;
      const pauseFraction = pauseDurationMs / totalDurationMs;

      // Animación continua y secuencial:
      // 0% a pauseFraction: se mantiene en posición 0 (pausa 4.5s)
      // pauseFraction a 100%: se desplaza lentamente hacia la izquierda
      // Al llegar a 100%, el duplicado está en posición 0 y el bucle se reinicia de forma idéntica sin salto
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

async function requestNotificationPermission() {
  try {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    }
  } catch (e) {
    console.warn('[AURA] Aviso al solicitar permisos de notificación:', e);
  }
}

function updatePlayPauseIcons(isPaused) {
  const barPlay = document.getElementById('btnBarPlay');
  const fsPlay = document.getElementById('btnFsPlay');

  const icon = isPaused ? '<i class="ph-fill ph-play"></i>' : '<i class="ph-fill ph-pause"></i>';
  if (barPlay) barPlay.innerHTML = icon;
  if (fsPlay) fsPlay.innerHTML = icon;
}

function updateProgressDisplay(currentTime, duration) {
  if (isNaN(duration) || duration <= 0) return;

  const percent = Math.min(100, Math.max(0, (currentTime / duration) * 100));

  // Mini barra en el borde superior del dock
  const barFill = document.getElementById('playerBarFill');
  if (barFill) barFill.style.width = `${percent}%`;

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
  if (!btnFav || !track) return;

  const isFav = playlistManager.isFavorite(track);
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
      if (!tracks || tracks.length === 0) {
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
      await downloadEntirePlaylistAndroid(plName, plTracks, btnEl);
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
          downloadEntirePlaylistAndroid(name, trks, null);
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
    }
  });
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
  const safeTitle = rawTitle.replace(/[<>:"/\\|?*]/g, '').trim();

  if (isTrackDownloaded(track)) {
    uiManager.showToast(`"${rawTitle}" ya está descargada en tu dispositivo 💾`);
    return;
  }

  uiManager.showToast(`Descargando "${rawTitle}"... ⏳`);

  try {
    const url = track.urlYoutube || track.url;
    if (!url) throw new Error('No hay URL de YouTube disponible');

    const streamUrl = await obtenerEnlaceAudio(url);
    if (!streamUrl) throw new Error('No se pudo resolver el audio');

    const fileName = `${safeTitle}.mp3`;
    const relativePath = `AURA/${fileName}`;
    let localUrl = null;

    if (window.Capacitor?.isNativePlatform?.() || window.Capacitor) {
      await Filesystem.downloadFile({
        url: streamUrl,
        path: relativePath,
        directory: Directory.Data
      });

      const uriResult = await Filesystem.getUri({
        directory: Directory.Data,
        path: relativePath
      });

      localUrl = window.Capacitor?.convertFileSrc
        ? window.Capacitor.convertFileSrc(uriResult.uri)
        : uriResult.uri;
    } else {
      // Navegador web directo
      const a = document.createElement('a');
      a.href = streamUrl;
      a.download = fileName;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      localUrl = streamUrl;
    }

    registerDownloadedTrack(track, relativePath, localUrl);
    uiManager.showToast(`✓ Descarga completada: ${rawTitle} 📥`);
    refreshCurrentTrackListUI();
  } catch (err) {
    console.error('[Download] Error al descargar pista:', err);
    uiManager.showToast(`Error al descargar: ${err.message}`);
  }
}

async function deleteDownloadedTrack(track) {
  if (!track) return;
  const rawTitle = track.titulo || track.title || 'Pista';
  const info = getDownloadedTrackInfo(track);

  if (!info) {
    uiManager.showToast('Esta canción no está guardada localmente.');
    return;
  }

  try {
    if (info.path && (window.Capacitor?.isNativePlatform?.() || window.Capacitor)) {
      await Filesystem.deleteFile({
        path: info.path,
        directory: Directory.Data
      }).catch((e) => console.warn('[Storage] Error borrando archivo físico:', e));
    }
  } catch (err) {
    console.warn(err);
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
      const info = getDownloadedTrackInfo(track);
      if (info && info.path && (window.Capacitor?.isNativePlatform?.() || window.Capacitor)) {
        try {
          await Filesystem.deleteFile({
            path: info.path,
            directory: Directory.Data
          });
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
}

/**
 * Descarga por lotes todas las canciones de una playlist en almacenamiento local del dispositivo
 */
async function downloadEntirePlaylistAndroid(playlistName, tracks, btnEl) {
  if (!tracks || tracks.length === 0) {
    uiManager.showToast('La playlist no tiene canciones para descargar.');
    return;
  }

  const originalHtml = btnEl ? btnEl.innerHTML : null;
  if (btnEl) btnEl.disabled = true;
  uiManager.showToast(`Descargando ${tracks.length} canciones de "${playlistName}"... 🚀`);

  let count = 0;
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if (btnEl) btnEl.innerHTML = `⏳ ${i + 1}/${tracks.length}`;
    const rawTitle = track.titulo || track.title || `Pista_${i + 1}`;
    const safeTitle = rawTitle.replace(/[<>:"/\\|?*]/g, '').trim();

    try {
      const url = track.urlYoutube || track.url;
      if (url) {
        const streamUrl = await obtenerEnlaceAudio(url);
        if (streamUrl) {
          const relativePath = `AURA/${safeTitle}.mp3`;
          let localUrl = null;

          if (window.Capacitor?.isNativePlatform?.() || window.Capacitor) {
            await Filesystem.downloadFile({
              url: streamUrl,
              path: relativePath,
              directory: Directory.Data
            });

            const uriResult = await Filesystem.getUri({
              directory: Directory.Data,
              path: relativePath
            });

            localUrl = window.Capacitor?.convertFileSrc
              ? window.Capacitor.convertFileSrc(uriResult.uri)
              : uriResult.uri;
          }

          registerDownloadedTrack(track, relativePath, localUrl);
          count++;
        }
      }
    } catch (err) {
      console.warn(`[AURA Download] Falló "${safeTitle}":`, err.message);
    }
  }

  if (btnEl) {
    btnEl.disabled = false;
    btnEl.innerHTML = '<i class="ph-fill ph-check-circle" style="color: var(--neon-lime);"></i> <span>Listo</span>';
    setTimeout(() => {
      if (btnEl && originalHtml) btnEl.innerHTML = originalHtml;
    }, 4000);
  }

  uiManager.showToast(`✓ Descarga completada: ${count} de ${tracks.length} guardadas en dispositivo.`);
  refreshCurrentTrackListUI();
}

/**
 * Detección de conectividad online/offline en tiempo real
 */
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

/**
 * Manejo nativo del botón y gesto de retroceso en Android (Capacitor) con doble toque para salir
 */
let lastBackPressTime = 0;

function initAndroidBackButton() {
  App.addListener('backButton', () => {
    // 1. Modales de Acción (3 puntos) y Diálogos
    const modalSong = document.getElementById('modalSongActions');
    if (modalSong && modalSong.classList.contains('open')) {
      uiManager.closeModal(modalSong);
      return;
    }
    const modalPl = document.getElementById('modalPlaylistActions');
    if (modalPl && modalPl.classList.contains('open')) {
      uiManager.closeModal(modalPl);
      return;
    }
    const modalAdd = document.getElementById('modalAddToPlaylist');
    if (modalAdd && modalAdd.classList.contains('open')) {
      uiManager.closeModal(modalAdd);
      return;
    }
    const modalQr = document.getElementById('modalShareQr');
    if (modalQr && modalQr.classList.contains('open')) {
      uiManager.closeModal(modalQr);
      return;
    }

    // 2. Escáner de cámara
    const camContainer = document.getElementById('lector-camara-container');
    if (camContainer && !camContainer.classList.contains('hidden')) {
      document.getElementById('btnCerrarCamara')?.click();
      return;
    }

    // 3. Cola de reproducción
    const queueDrawer = document.getElementById('queueDrawer');
    if (queueDrawer && queueDrawer.classList.contains('open')) {
      queueDrawer.classList.remove('open');
      return;
    }

    // 4. Reproductor Fullscreen
    const fsPlayer = document.getElementById('fullscreenPlayer');
    if (fsPlayer && fsPlayer.classList.contains('open')) {
      fsPlayer.classList.remove('open');
      return;
    }

    // 5. Modo Conducción
    if (carModeManager && carModeManager.isActive) {
      carModeManager.deactivate();
      return;
    }

    // 6. Sub-vista Detalle de Playlist
    const detailView = document.getElementById('vista-playlist-detalle');
    if (detailView && detailView.classList.contains('view-active')) {
      document.getElementById('btnVolverBiblioteca')?.click();
      return;
    }

    // 7. Si no estamos en la pestaña principal de búsqueda, regresar a búsqueda
    const activeTab = document.querySelector('.nav-tab-btn.tab-active');
    if (activeTab && activeTab.dataset.view !== 'vista-busqueda') {
      document.getElementById('tabBuscar')?.click();
      return;
    }

    // 8. Doble toque para salir de la aplicación (evita cierres por accidente)
    const now = Date.now();
    if (now - lastBackPressTime < 2200) {
      App.exitApp();
    } else {
      lastBackPressTime = now;
      uiManager.showToast('Presiona de nuevo para salir de AURA 🚪');
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
}
