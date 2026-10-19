/**
 * AURA Music - Interfaz de Usuario y Renderizado del DOM
 */

import { playlistManager } from './playlists.js';
import { isTrackDownloaded } from './storage.js';

export class UIManager {
  constructor() {
    this.toastContainer = document.getElementById('toast-container');
    this.pendingTrackForModal = null;
  }

  showToast(message) {
    if (!this.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    this.toastContainer.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 20);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 260);
    }, 2800);
  }

  switchTab(targetViewId) {
    const views = document.querySelectorAll('.view-section');
    views.forEach((v) => {
      if (v.id === targetViewId) {
        v.classList.add('view-active');
      } else {
        v.classList.remove('view-active');
      }
    });

    const tabs = document.querySelectorAll('.nav-tab-btn');
    tabs.forEach((t) => {
      if (t.dataset.view === targetViewId) {
        t.classList.add('tab-active');
      } else {
        t.classList.remove('tab-active');
      }
    });
  }

  renderRecentSearches(searches, onSelect, onDelete) {
    const container = document.getElementById('contenedorRecientes');
    const section = document.getElementById('seccionRecientes');
    if (!container || !section) return;

    container.innerHTML = '';
    if (!searches || searches.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    searches.forEach((term) => {
      const chip = document.createElement('div');
      chip.className = 'recent-chip';
      chip.innerHTML = `
        <span><i class="ph ph-magnifying-glass"></i> ${term}</span>
        <button class="btn-del-recent" title="Eliminar"><i class="ph-bold ph-x"></i></button>
      `;

      chip.addEventListener('click', (e) => {
        if (e.target.closest('.btn-del-recent')) return;
        onSelect(term);
      });

      const delBtn = chip.querySelector('.btn-del-recent');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onDelete(term);
      });

      container.appendChild(chip);
    });
  }

  renderSearchResults(tracks, callbacks) {
    const list = document.getElementById('listaBusqueda');
    if (!list) return;

    list.innerHTML = '';
    if (!tracks || tracks.length === 0) {
      list.innerHTML = `
        <li style="text-align: center; color: var(--text-muted); padding: 40px 0;">
          <i class="ph ph-music-notes" style="font-size: 2.5rem; display: block; margin-bottom: 12px; color: var(--border-subtle);"></i>
          No se encontraron canciones. Intenta con otra búsqueda.
        </li>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();

    tracks.forEach((track, index) => {
      const li = document.createElement('li');
      li.className = 'song-item';

      const isFav = playlistManager.isFavorite(track);
      const isDown = isTrackDownloaded(track);
      const thumb = track.thumbnail || '/icon.png';

      li.innerHTML = `
        <div class="song-item-left">
          <div class="song-thumb-wrapper">
            <img src="${thumb}" alt="Cover" class="song-thumb" loading="lazy" />
            <div class="song-thumb-overlay">
              <i class="ph-fill ph-play" style="font-size: 1.2rem;"></i>
            </div>
          </div>
          <div class="song-info">
            <h4 class="song-title" title="${track.title}">
              <span>${track.title}</span>
            </h4>
            <div class="song-meta">
              ${isDown ? '<span class="download-tag"><i class="ph-bold ph-check"></i> Guardada</span><span>•</span>' : ''}
              <span>${track.channel || 'YouTube'}</span>
              <span>•</span>
              <span><i class="ph ph-clock"></i> ${track.duration || '0:00'}</span>
            </div>
          </div>
          ${isDown ? '<span class="download-led" title="Descargada en el dispositivo (Offline)"></span>' : ''}
        </div>
        <div class="song-item-actions song-desktop-actions">
          <button class="btn-icon-subtle btn-fav ${isFav ? 'is-fav' : ''}" title="${isFav ? 'Quitar de Favoritas' : 'Marcar Favorita'}">
            <i class="${isFav ? 'ph-fill ph-heart' : 'ph-bold ph-heart'}"></i>
          </button>
          <button class="btn-icon-subtle btn-add-pl" title="Añadir a Playlist">
            <i class="ph-bold ph-playlist"></i>
          </button>
          <button class="btn-icon-subtle btn-download-track" title="${isDown ? 'Eliminar descarga' : 'Descargar MP3'}">
            <i class="${isDown ? 'ph-bold ph-trash' : 'ph-bold ph-download-simple'}" style="${isDown ? 'color: var(--neon-gold);' : ''}"></i>
          </button>
          <button class="btn-icon-subtle btn-share-qr" title="Compartir QR">
            <i class="ph-bold ph-qr-code"></i>
          </button>
        </div>
        <button class="btn-song-menu" title="Opciones de la canción">
          <i class="ph-bold ph-dots-three-vertical"></i>
        </button>
      `;

      // Clic para reproducir pista
      li.querySelector('.song-item-left').addEventListener('click', () => {
        callbacks.onPlay(track, tracks, index);
      });

      // Favorito (Desktop)
      const favBtn = li.querySelector('.btn-fav');
      favBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onToggleFav(track, favBtn);
      });

      // Añadir a playlist (Desktop)
      li.querySelector('.btn-add-pl')?.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onAddToPlaylist(track);
      });

      // Descargar / Eliminar descarga (Desktop)
      li.querySelector('.btn-download-track')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isDown) {
          callbacks.onDeleteDownload?.(track);
        } else {
          callbacks.onDownload?.(track);
        }
      });

      // Compartir QR (Desktop)
      li.querySelector('.btn-share-qr')?.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onShareQr(track);
      });

      // 3 Puntos Móvil (Abre Bottom Action Sheet)
      li.querySelector('.btn-song-menu')?.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onOpenSongMenu?.(track, index, { isInPlaylist: false });
      });

      fragment.appendChild(li);
    });

    list.appendChild(fragment);
  }

  renderPlaylists(playlists, onOpenPlaylist) {
    const container = document.getElementById('contenedorPlaylists');
    if (!container) return;
    container.innerHTML = '';

    const allTracks = playlistManager.getAllUniqueTracks();

    // 1. Tarjeta Especial: "Todas las canciones"
    const cardAll = document.createElement('div');
    cardAll.className = 'playlist-card';
    cardAll.style.borderColor = 'var(--neon-cyan)';
    cardAll.innerHTML = `
      <div class="playlist-card-icon" style="background: rgba(0, 240, 255, 0.15);">
        <i class="ph-fill ph-sparkle"></i>
      </div>
      <h3 class="playlist-card-title">Todas las Canciones</h3>
      <span class="playlist-card-count">${allTracks.length} pista${allTracks.length === 1 ? '' : 's'}</span>
    `;
    cardAll.addEventListener('click', () => {
      onOpenPlaylist('__todas__', allTracks);
    });
    container.appendChild(cardAll);

    // 2. Playlists del usuario
    for (const [name, tracks] of Object.entries(playlists)) {
      const card = document.createElement('div');
      card.className = 'playlist-card';
      const isFav = name === 'Favoritas';

      card.innerHTML = `
        <div class="playlist-card-icon" style="${isFav ? 'color: var(--neon-magenta);' : ''}">
          <i class="${isFav ? 'ph-fill ph-heart' : 'ph-fill ph-music-notes'}"></i>
        </div>
        <h3 class="playlist-card-title">${name}</h3>
        <span class="playlist-card-count">${tracks.length} canción${tracks.length === 1 ? '' : 'es'}</span>
      `;

      card.addEventListener('click', () => {
        onOpenPlaylist(name, tracks);
      });

      container.appendChild(card);
    }
  }

  renderPlaylistDetail(title, tracks, callbacks) {
    const titleEl = document.getElementById('tituloPlaylistDetalle');
    const statsEl = document.getElementById('statsPlaylistDetalle');
    const listEl = document.getElementById('listaPlaylistDetalle');
    const actionsEl = document.getElementById('accionesPlaylistDetalle');

    if (titleEl) titleEl.innerText = title === '__todas__' ? 'Todas las Canciones' : title;
    const stats = playlistManager.getStats(tracks);
    if (statsEl) {
      statsEl.innerText = `📋 ${stats.count} canciones • ⏱️ ${stats.durationText}`;
    }

    const topActionsEl = document.getElementById('accionesPlaylistTop');
    const mainActionsEl = document.getElementById('accionesPlaylistDetalle') || actionsEl;

    if (topActionsEl) topActionsEl.innerHTML = '';
    if (mainActionsEl) mainActionsEl.innerHTML = '';

    if (mainActionsEl) {
      // 1. Botón Play All (Siempre visible en móvil y desktop)
      const btnPlayAll = document.createElement('button');
      btnPlayAll.className = 'btn-playlist-play-all';
      btnPlayAll.title = 'Reproducir toda la playlist';
      btnPlayAll.innerHTML = '<i class="ph-fill ph-play"></i> <span>Reproducir</span>';
      btnPlayAll.addEventListener('click', () => callbacks.onPlayAll());
      mainActionsEl.appendChild(btnPlayAll);

      // 2. Botón 3 Puntos para Móvil
      const btnPlMenu = document.createElement('button');
      btnPlMenu.className = 'btn-playlist-menu';
      btnPlMenu.title = 'Opciones de Playlist';
      btnPlMenu.innerHTML = '<i class="ph-bold ph-dots-three-vertical"></i>';
      btnPlMenu.addEventListener('click', () => {
        callbacks.onOpenPlaylistMenu?.(title, tracks);
      });
      mainActionsEl.appendChild(btnPlMenu);

      // 3. Contenedor de Botones de Escritorio (Desktop/Web)
      const desktopActions = document.createElement('div');
      desktopActions.className = 'playlist-desktop-actions';
      desktopActions.style.display = 'flex';
      desktopActions.style.alignItems = 'center';
      desktopActions.style.gap = '8px';

      // Botón Descargar Playlist Completa (Desktop)
      if (callbacks.onDownloadPlaylist && tracks && tracks.length > 0) {
        const allDownloaded = tracks.every((t) => isTrackDownloaded(t));
        const btnDownload = document.createElement('button');
        btnDownload.className = `btn-header-download ${allDownloaded ? 'is-all-downloaded' : ''}`;
        btnDownload.id = 'btnDownloadEntirePlaylist';
        if (allDownloaded) {
          btnDownload.disabled = true;
          btnDownload.title = 'Todas las canciones de esta playlist ya están descargadas';
          btnDownload.innerHTML = '<i class="ph-bold ph-check-circle" style="color: var(--neon-emerald);"></i> <span>Descargada</span>';
        } else {
          btnDownload.title = 'Descargar toda la playlist';
          btnDownload.innerHTML = '<i class="ph-bold ph-download-simple"></i> <span>Descargar</span>';
          btnDownload.addEventListener('click', () => callbacks.onDownloadPlaylist(title, tracks, btnDownload));
        }
        desktopActions.appendChild(btnDownload);
      }

      // Botón Compartir QR (Desktop)
      if (title !== '__todas__') {
        const btnQr = document.createElement('button');
        btnQr.className = 'btn-header-action';
        btnQr.title = 'Compartir Playlist por QR';
        btnQr.innerHTML = '<i class="ph-bold ph-qr-code"></i>';
        btnQr.addEventListener('click', () => callbacks.onShareQr());
        desktopActions.appendChild(btnQr);
      }

      // Botón Eliminar Playlist (Desktop)
      if (title !== 'Favoritas' && title !== '__todas__') {
        const btnDel = document.createElement('button');
        btnDel.className = 'btn-header-action';
        btnDel.title = 'Eliminar Playlist';
        btnDel.innerHTML = '<i class="ph-bold ph-trash" style="color: var(--neon-red);"></i>';
        btnDel.addEventListener('click', () => callbacks.onDeletePlaylist());
        desktopActions.appendChild(btnDel);
      }

      mainActionsEl.appendChild(desktopActions);
    }

    if (listEl) {
      listEl.innerHTML = '';
      if (!tracks || tracks.length === 0) {
        listEl.innerHTML = `
          <li style="text-align: center; color: var(--text-muted); padding: 40px 0;">
            Esta playlist aún no tiene canciones guardadas.
          </li>
        `;
        return;
      }

      const fragment = document.createDocumentFragment();

      tracks.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = 'song-item';
        li.dataset.index = index;
        const thumb = track.thumbnail || '/icon.png';
        const isDown = isTrackDownloaded(track);

        // Sin drag-handle en playlists: el reordenamiento solo existe en la cola según las indicaciones
        li.innerHTML = `
          <div class="song-item-left">
            <div class="song-thumb-wrapper">
              <img src="${thumb}" alt="Cover" class="song-thumb" loading="lazy" />
              <div class="song-thumb-overlay">
                <i class="ph-fill ph-play"></i>
              </div>
            </div>
            <div class="song-info">
              <h4 class="song-title" title="${track.titulo || track.title}">
                <span>${track.titulo || track.title}</span>
              </h4>
              <div class="song-meta">
                ${isDown ? '<span class="download-tag"><i class="ph-bold ph-check"></i> Guardada</span><span>•</span>' : ''}
                <span>${track.duracion || '0:00'}</span>
              </div>
            </div>
            ${isDown ? '<span class="download-led" title="Descargada en el dispositivo (Offline)"></span>' : ''}
          </div>
          <div class="song-item-actions song-desktop-actions">
            <button class="btn-icon-subtle btn-play-track" title="Reproducir">
              <i class="ph-fill ph-play"></i>
            </button>
            <button class="btn-icon-subtle btn-download-track" title="${isDown ? 'Eliminar descarga' : 'Descargar MP3'}">
              <i class="${isDown ? 'ph-bold ph-trash' : 'ph-bold ph-download-simple'}" style="${isDown ? 'color: var(--neon-gold);' : ''}"></i>
            </button>
            ${
              title !== '__todas__'
                ? `<button class="btn-icon-subtle btn-remove-track" title="Eliminar de playlist">
                     <i class="ph-bold ph-trash" style="color: var(--neon-red);"></i>
                   </button>`
                : ''
            }
          </div>
          <button class="btn-song-menu" title="Opciones">
            <i class="ph-bold ph-dots-three-vertical"></i>
          </button>
        `;

        li.querySelector('.song-item-left').addEventListener('click', () => {
          callbacks.onPlayTrack(track, index);
        });

        li.querySelector('.btn-play-track')?.addEventListener('click', (e) => {
          e.stopPropagation();
          callbacks.onPlayTrack(track, index);
        });

        li.querySelector('.btn-download-track')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isDown) {
            callbacks.onDeleteDownload?.(track);
          } else {
            callbacks.onDownload?.(track);
          }
        });

        if (title !== '__todas__') {
          const btnRem = li.querySelector('.btn-remove-track');
          if (btnRem) {
            btnRem.addEventListener('click', (e) => {
              e.stopPropagation();
              callbacks.onRemoveTrack(index);
            });
          }
        }

        // 3 Puntos Móvil
        li.querySelector('.btn-song-menu')?.addEventListener('click', (e) => {
          e.stopPropagation();
          callbacks.onOpenSongMenu?.(track, index, { isInPlaylist: true, playlistName: title, playlistIndex: index });
        });

        fragment.appendChild(li);
      });

      listEl.appendChild(fragment);
      // NOTE: Reordenamiento deshabilitado en playlist por especificación del usuario
    }
  }

  renderQueueList(queue, currentIndex, onSelect, onRemove, onReorder) {
    const list = document.getElementById('listaCola');
    if (!list) return;
    list.innerHTML = '';

    if (!queue || queue.length === 0) {
      list.innerHTML = `
        <li style="text-align: center; color: var(--text-muted); padding: 30px 0;">
          La cola de reproducción está vacía.
        </li>
      `;
      return;
    }

    queue.forEach((track, index) => {
      const li = document.createElement('li');
      li.className = `song-item ${index === currentIndex ? 'is-playing' : ''}`;
      li.dataset.index = index;
      const thumb = track.thumbnail || '/icon.png';

      li.innerHTML = `
        <div class="drag-handle" title="Mantén presionado para mover">
          <i class="ph-bold ph-dots-six-vertical"></i>
        </div>
        <div class="song-item-left">
          <div class="song-thumb-wrapper">
            <img src="${thumb}" alt="Thumb" class="song-thumb" />
          </div>
          <div class="song-info">
            <h4 class="song-title">
              <span>${index + 1}. ${track.titulo || track.title}</span>
            </h4>
            <span class="song-meta">${track.duracion || track.duration || '0:00'}</span>
          </div>
          ${isTrackDownloaded(track) ? '<span class="download-led" title="Descargada (Offline)"></span>' : ''}
        </div>
        <div class="song-item-actions">
          <button class="btn-icon-subtle btn-del-queue" title="Quitar de la cola">
            <i class="ph-bold ph-x"></i>
          </button>
        </div>
      `;

      li.querySelector('.song-item-left').addEventListener('click', () => {
        onSelect(index);
      });

      li.querySelector('.btn-del-queue').addEventListener('click', (e) => {
        e.stopPropagation();
        onRemove(index);
      });

      list.appendChild(li);
    });

    if (onReorder && queue.length > 1) {
      makeListReorderable(list, onReorder);
    }
  }

  renderRapidKeysList(keys, onRemove) {
    const list = document.getElementById('listaRapidKeys');
    const count = document.getElementById('lblCountRapidKeys');
    if (!list) return;

    list.innerHTML = '';
    if (count) count.innerText = `${keys.length} llave${keys.length === 1 ? '' : 's'}`;

    if (keys.length === 0) {
      list.innerHTML = '<li style="color: var(--neon-red); font-size: 0.85rem; text-align: center; padding: 10px;">⚠️ No hay llaves. Las canciones fallarán.</li>';
      return;
    }

    keys.forEach((key, index) => {
      const li = document.createElement('li');
      li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border-subtle);';
      const visible = key.length > 20 ? key.slice(0, 10) + '...' + key.slice(-4) : key;

      li.innerHTML = `
        <span style="font-family: monospace; font-size: 0.82rem; color: var(--text-muted);">${index + 1}. ${visible}</span>
        <button class="btn-icon-subtle btn-del-key" style="color: var(--neon-red);" title="Eliminar"><i class="ph-bold ph-trash"></i></button>
      `;

      li.querySelector('.btn-del-key').addEventListener('click', () => onRemove(index));
      list.appendChild(li);
    });
  }

  openAddToPlaylistModal(track, playlists, onSelect) {
    const modal = document.getElementById('modalAddToPlaylist');
    const songTitleEl = document.getElementById('modalAddSongTitle');
    const songArtistEl = document.getElementById('modalAddSongArtist');
    const songThumbEl = document.getElementById('modalAddSongThumb');
    const filterInput = document.getElementById('inputModalFilterPlaylists');
    if (!modal) return;

    this.pendingTrackForModal = track;
    this.modalPlaylistsCallback = onSelect;
    const title = track.titulo || track.title || 'Música';
    const isOffline = isTrackDownloaded(track) || track.tipo === 'offline';
    const artist = track.channel || (isOffline ? 'AURA Offline 💾' : 'AURA Streaming');
    const thumb = track.thumbnail || '/icon.png';

    if (songTitleEl) songTitleEl.innerText = title;
    if (songArtistEl) songArtistEl.innerText = artist;
    if (songThumbEl) songThumbEl.src = thumb;
    if (filterInput) filterInput.value = '';

    this.renderModalPlaylistItems(playlists, onSelect);
    modal.classList.add('open');
  }

  renderModalPlaylistItems(playlists, onSelect, filterText = '') {
    const listContainer = document.getElementById('modalPlaylistsList');
    if (!listContainer || !this.pendingTrackForModal) return;
    listContainer.innerHTML = '';

    let names = Object.keys(playlists);
    if (filterText) {
      const q = filterText.toLowerCase();
      names = names.filter((n) => n.toLowerCase().includes(q));
    }

    if (names.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 24px 0;">
          <i class="ph-bold ph-folder-dashed" style="font-size: 2rem; display: block; margin-bottom: 6px; opacity: 0.5;"></i>
          ${filterText ? 'No se encontraron playlists con ese nombre.' : 'No tienes playlists creadas todavía.'}
        </div>
      `;
      return;
    }

    const track = this.pendingTrackForModal;
    const trackUrl = track.urlYoutube || track.url;

    names.forEach((name) => {
      const items = playlists[name] || [];
      const isAlreadyIn = items.some(
        (t) => (trackUrl && (t.urlYoutube === trackUrl || t.url === trackUrl)) || (t.titulo && t.titulo === (track.titulo || track.title))
      );

      const div = document.createElement('div');
      div.className = `playlist-picker-item ${isAlreadyIn ? 'already-added' : ''}`;

      const iconClass = name === 'Favoritas' ? 'ph-fill ph-heart' : 'ph-fill ph-playlist';
      const iconStyle = name === 'Favoritas' ? 'background: rgba(255, 46, 196, 0.2); color: var(--neon-magenta);' : '';

      div.innerHTML = `
        <div class="playlist-picker-left">
          <div class="playlist-picker-icon" style="${iconStyle}">
            <i class="${iconClass}"></i>
          </div>
          <div class="playlist-picker-info">
            <h4 class="playlist-picker-name">${name}</h4>
            <span class="playlist-picker-count">${items.length} canción${items.length === 1 ? '' : 'es'}</span>
          </div>
        </div>
        <div class="playlist-picker-action">
          ${
            isAlreadyIn
              ? '<span class="picker-badge-added"><i class="ph-fill ph-check-circle"></i> Añadida</span>'
              : '<button class="btn-picker-add" type="button"><i class="ph-bold ph-plus"></i> Añadir</button>'
          }
        </div>
      `;

      div.addEventListener('click', () => {
        if (onSelect) {
          onSelect(name, track, div);
        }
      });

      listContainer.appendChild(div);
    });
  }

  openSongActionSheet(track, options = {}, callbacks = {}) {
    const modal = document.getElementById('modalSongActions');
    if (!modal || !track) return;

    const isFav = playlistManager.isFavorite(track);
    const isDownloaded = isTrackDownloaded(track);
    const isOffline = isDownloaded || track.tipo === 'offline';
    const title = track.titulo || track.title || 'Canción';
    const artist = track.channel || (isOffline ? 'AURA Offline 💾' : 'AURA');
    const thumb = track.thumbnail || '/icon.png';

    const thumbEl = document.getElementById('songActionThumb');
    const titleEl = document.getElementById('songActionTitle');
    const artistEl = document.getElementById('songActionArtist');
    if (thumbEl) thumbEl.src = thumb;
    if (titleEl) titleEl.innerText = title;
    if (artistEl) artistEl.innerText = artist;

    // Favorito icon & label
    const iconFav = document.getElementById('iconActionFav');
    const lblFav = document.getElementById('lblActionFav');
    if (iconFav && lblFav) {
      iconFav.className = isFav ? 'ph-fill ph-heart action-icon-magenta' : 'ph-bold ph-heart action-icon-magenta';
      lblFav.innerText = isFav ? 'Quitar de Favoritas' : 'Marcar como Favorita';
    }

    // Descarga icon & label
    const iconDown = document.getElementById('iconActionDownload');
    const lblDown = document.getElementById('lblActionDownload');
    if (iconDown && lblDown) {
      iconDown.className = isDownloaded ? 'ph-bold ph-trash action-icon-gold' : 'ph-bold ph-download-simple action-icon-gold';
      lblDown.innerText = isDownloaded ? 'Eliminar audio descargado' : 'Descargar Canción (MP3)';
    }

    // Quitar de playlist (solo si estamos en una lista no global)
    const btnRemove = document.getElementById('btnActionRemoveFromPlaylist');
    if (btnRemove) {
      if (options.isInPlaylist && options.playlistName && options.playlistName !== '__todas__') {
        btnRemove.style.display = 'flex';
        btnRemove.onclick = () => {
          modal.classList.remove('open');
          if (callbacks.onRemoveFromPlaylist) callbacks.onRemoveFromPlaylist(track, options.playlistIndex);
        };
      } else {
        btnRemove.style.display = 'none';
      }
    }

    // Reproducir ahora
    const btnPlay = document.getElementById('btnActionPlayNow');
    if (btnPlay) {
      btnPlay.onclick = () => {
        modal.classList.remove('open');
        if (callbacks.onPlay) callbacks.onPlay(track);
      };
    }

    // Agregar a la cola
    const btnQueue = document.getElementById('btnActionAddToQueue');
    if (btnQueue) {
      btnQueue.onclick = () => {
        modal.classList.remove('open');
        if (callbacks.onAddToQueue) callbacks.onAddToQueue(track);
      };
    }

    // Toggle Favorita
    const btnFav = document.getElementById('btnActionToggleFav');
    if (btnFav) {
      btnFav.onclick = () => {
        modal.classList.remove('open');
        if (callbacks.onToggleFav) callbacks.onToggleFav(track);
      };
    }

    // Descargar / Eliminar descarga
    const btnDown = document.getElementById('btnActionDownload');
    if (btnDown) {
      btnDown.onclick = () => {
        modal.classList.remove('open');
        if (isDownloaded) {
          if (callbacks.onDeleteDownload) callbacks.onDeleteDownload(track);
        } else {
          if (callbacks.onDownload) callbacks.onDownload(track);
        }
      };
    }

    // Añadir a playlist
    const btnAddPl = document.getElementById('btnActionAddToPlaylist');
    if (btnAddPl) {
      btnAddPl.onclick = () => {
        modal.classList.remove('open');
        if (callbacks.onAddToPlaylist) callbacks.onAddToPlaylist(track);
      };
    }

    // Compartir QR
    const btnQr = document.getElementById('btnActionShareQr');
    if (btnQr) {
      btnQr.onclick = () => {
        modal.classList.remove('open');
        if (callbacks.onShareQr) callbacks.onShareQr(track);
      };
    }

    // Botón Cerrar
    const btnClose = document.getElementById('btnCloseSongActions');
    if (btnClose) {
      btnClose.onclick = () => modal.classList.remove('open');
    }

    modal.classList.add('open');
  }

  openPlaylistActionSheet(playlistName, tracks, callbacks = {}) {
    const modal = document.getElementById('modalPlaylistActions');
    if (!modal) return;

    const titleEl = document.getElementById('playlistActionTitle');
    const countEl = document.getElementById('playlistActionCount');
    if (titleEl) titleEl.innerText = playlistName === '__todas__' ? 'Todas las Canciones' : playlistName;
    if (countEl) countEl.innerText = `${(tracks || []).length} canciones`;

    // Descargar todas (Deshabilitado si ya están todas descargadas)
    const hasTracks = tracks && tracks.length > 0;
    const allDownloaded = hasTracks && tracks.every((t) => isTrackDownloaded(t));
    const anyDownloaded = hasTracks && tracks.some((t) => isTrackDownloaded(t));

    const btnDownloadAll = document.getElementById('btnPlActionDownloadAll');
    if (btnDownloadAll) {
      if (allDownloaded) {
        btnDownloadAll.classList.add('disabled');
        btnDownloadAll.style.opacity = '0.55';
        btnDownloadAll.style.pointerEvents = 'none';
        btnDownloadAll.innerHTML = '<i class="ph-bold ph-check-circle" style="color: var(--neon-emerald);"></i> <span>Todas descargadas ✓</span>';
      } else {
        btnDownloadAll.classList.remove('disabled');
        btnDownloadAll.style.opacity = '1';
        btnDownloadAll.style.pointerEvents = 'auto';
        btnDownloadAll.innerHTML = '<i class="ph-bold ph-download-simple"></i> <span>Descargar todas las canciones</span>';
        btnDownloadAll.onclick = () => {
          modal.classList.remove('open');
          if (callbacks.onDownloadPlaylist) callbacks.onDownloadPlaylist(playlistName, tracks);
        };
      }
    }

    // Eliminar canciones descargadas (Ocultar si no hay ninguna descargada)
    const btnDeleteDownloads = document.getElementById('btnPlActionDeleteDownloads');
    if (btnDeleteDownloads) {
      if (!anyDownloaded) {
        btnDeleteDownloads.style.display = 'none';
      } else {
        btnDeleteDownloads.style.display = 'flex';
        btnDeleteDownloads.onclick = () => {
          modal.classList.remove('open');
          if (callbacks.onDeleteDownloadedTracks) callbacks.onDeleteDownloadedTracks(tracks, playlistName);
        };
      }
    }

    // Compartir QR
    const btnShareQr = document.getElementById('btnPlActionShareQr');
    if (btnShareQr) {
      if (playlistName === '__todas__') {
        btnShareQr.style.display = 'none';
      } else {
        btnShareQr.style.display = 'flex';
        btnShareQr.onclick = () => {
          modal.classList.remove('open');
          if (callbacks.onShareQr) callbacks.onShareQr(playlistName, tracks);
        };
      }
    }

    // Eliminar Playlist
    const btnDeletePl = document.getElementById('btnPlActionDeletePlaylist');
    if (btnDeletePl) {
      if (playlistName === '__todas__' || playlistName === 'Favoritas') {
        btnDeletePl.style.display = 'none';
      } else {
        btnDeletePl.style.display = 'flex';
        btnDeletePl.onclick = () => {
          modal.classList.remove('open');
          if (callbacks.onDeletePlaylist) callbacks.onDeletePlaylist(playlistName);
        };
      }
    }

    // Botón Cerrar
    const btnClose = document.getElementById('btnClosePlaylistActions');
    if (btnClose) {
      btnClose.onclick = () => modal.classList.remove('open');
    }

    modal.classList.add('open');
  }

  closeModal(modalElement) {
    if (modalElement) modalElement.classList.remove('open');
  }
}

/**
 * Permite reordenar elementos en listas mediante Drag & Drop (Escritorio) y Touch Hold & Drag (Móvil)
 */
function makeListReorderable(listElement, onReorder) {
  let draggedIndex = null;
  let touchStartY = 0;
  let touchStartIndex = null;
  let currentTargetIndex = null;
  let activeTouchLi = null;

  const items = listElement.querySelectorAll('li.song-item');

  items.forEach((li) => {
    const handle = li.querySelector('.drag-handle');
    const index = parseInt(li.dataset.index, 10);

    // Desktop HTML5 Drag & Drop
    if (handle) {
      handle.addEventListener('mousedown', () => {
        li.draggable = true;
      });
      handle.addEventListener('mouseup', () => {
        li.draggable = false;
      });
    }

    li.addEventListener('dragstart', (e) => {
      draggedIndex = index;
      li.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    });

    li.addEventListener('dragend', () => {
      li.classList.remove('is-dragging');
      li.draggable = false;
      items.forEach((el) => el.classList.remove('drag-over-top', 'drag-over-bottom'));
      draggedIndex = null;
    });

    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = li.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      items.forEach((el) => el.classList.remove('drag-over-top', 'drag-over-bottom'));
      if (relY < rect.height / 2) {
        li.classList.add('drag-over-top');
      } else {
        li.classList.add('drag-over-bottom');
      }
    });

    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetIndex = index;
      if (draggedIndex !== null && draggedIndex !== targetIndex) {
        onReorder(draggedIndex, targetIndex);
      }
    });

    // Mobile Touch Reordering (Mantener y Arrastrar)
    if (handle) {
      handle.addEventListener(
        'touchstart',
        (e) => {
          const touch = e.touches[0];
          touchStartY = touch.clientY;
          touchStartIndex = index;
          activeTouchLi = li;
          li.classList.add('is-dragging');
          if (navigator.vibrate) {
            try { navigator.vibrate(35); } catch (_) {}
          }
        },
        { passive: false }
      );

      handle.addEventListener(
        'touchmove',
        (e) => {
          if (touchStartIndex === null) return;
          e.preventDefault();
          const touch = e.touches[0];
          const elemUnder = document.elementFromPoint(touch.clientX, touch.clientY);
          const targetLi = elemUnder?.closest('li.song-item');

          items.forEach((el) => el.classList.remove('drag-over-top', 'drag-over-bottom'));

          if (targetLi && targetLi !== activeTouchLi) {
            currentTargetIndex = parseInt(targetLi.dataset.index, 10);
            const rect = targetLi.getBoundingClientRect();
            if (touch.clientY < rect.top + rect.height / 2) {
              targetLi.classList.add('drag-over-top');
            } else {
              targetLi.classList.add('drag-over-bottom');
            }
          }
        },
        { passive: false }
      );

      handle.addEventListener('touchend', () => {
        if (touchStartIndex !== null && currentTargetIndex !== null && touchStartIndex !== currentTargetIndex) {
          onReorder(touchStartIndex, currentTargetIndex);
        }
        if (activeTouchLi) activeTouchLi.classList.remove('is-dragging');
        items.forEach((el) => el.classList.remove('drag-over-top', 'drag-over-bottom'));
        touchStartIndex = null;
        currentTargetIndex = null;
        activeTouchLi = null;
      });

      handle.addEventListener('touchcancel', () => {
        if (activeTouchLi) activeTouchLi.classList.remove('is-dragging');
        items.forEach((el) => el.classList.remove('drag-over-top', 'drag-over-bottom'));
        touchStartIndex = null;
        currentTargetIndex = null;
        activeTouchLi = null;
      });
    }
  });
}

export const uiManager = new UIManager();
