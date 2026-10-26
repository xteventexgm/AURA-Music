import { app, shell, BrowserWindow, ipcMain, dialog, Tray, Menu, globalShortcut } from 'electron';
import { join, resolve } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import fs from 'fs';
import youtubedl from 'youtube-dl-exec';

let mainWindow = null;
let tray = null;
let carpetaDescargasActual = null;

function getDownloadFolder() {
  if (carpetaDescargasActual && fs.existsSync(carpetaDescargasActual)) {
    return carpetaDescargasActual;
  }
  // Carpeta por defecto: Music/AURA o Downloads/AURA
  const baseMusic = app.getPath('music') || app.getPath('downloads');
  const auraDir = join(baseMusic, 'AURA');
  if (!fs.existsSync(auraDir)) {
    try {
      fs.mkdirSync(auraDir, { recursive: true });
    } catch {
      return app.getPath('downloads');
    }
  }
  carpetaDescargasActual = auraDir;
  return carpetaDescargasActual;
}

function resolveSafeTrackPath(folder, titulo) {
  const baseFolder = resolve(folder);
  const cleanTitle = (titulo || 'AURA_Track')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '')
    .replace(/\.\.+/g, '')
    .trim() || 'AURA_Track';
  const finalPath = resolve(baseFolder, `${cleanTitle}.mp3`);
  if (!finalPath.startsWith(baseFolder)) {
    throw new Error('Acceso a ruta de archivo no autorizada');
  }
  return finalPath;
}

function isValidYouTubeUrl(input) {
  if (typeof input !== 'string') return false;
  const trimmed = input.trim();
  if (!trimmed || trimmed.startsWith('-')) return false;
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const allowed = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];
    return allowed.some((domain) => hostname === domain || hostname.endsWith('.' + domain));
  } catch {
    return false;
  }
}

function createWindow() {
  const iconPath = join(__dirname, '../../resources/icon.png');

  mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 920,
    minHeight: 620,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#07070e',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      webSecurity: false // Permite reproducir archivos locales file:// sin bloqueos
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:stateChange', { isMaximized: true });
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:stateChange', { isMaximized: false });
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function createTray() {
  const iconPath = join(__dirname, '../../resources/icon.png');
  try {
    tray = new Tray(iconPath);
    tray.setToolTip('AURA - Reproductor de Música Cyberpunk');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Abrir AURA',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Reproducir / Pausa',
        click: () => mainWindow?.webContents.send('media:togglePlay')
      },
      {
        label: 'Siguiente Canción',
        click: () => mainWindow?.webContents.send('media:next')
      },
      {
        label: 'Canción Anterior',
        click: () => mainWindow?.webContents.send('media:prev')
      },
      { type: 'separator' },
      {
        label: 'Salir de AURA',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (err) {
    console.warn('[AURA Main] Error inicializando Tray:', err);
  }
}

function registerGlobalShortcuts() {
  try {
    globalShortcut.register('MediaPlayPause', () => {
      mainWindow?.webContents.send('media:togglePlay');
    });
    globalShortcut.register('MediaNextTrack', () => {
      mainWindow?.webContents.send('media:next');
    });
    globalShortcut.register('MediaPreviousTrack', () => {
      mainWindow?.webContents.send('media:prev');
    });
  } catch (err) {
    console.warn('[AURA Main] Atajos multimedia warning:', err);
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.aura.music');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  const archivoDatosAura = join(app.getPath('userData'), 'aura_desktop_data.json');
  const archivoDatosLegacy = join(app.getPath('userData'), 'mis_datos_reproductor.json');

  // Inicializar carpeta de descargas
  getDownloadFolder();

  // 1. IPC - Controles de Ventana (Custom Titlebar)
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    } else {
      mainWindow?.maximize();
      return true;
    }
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() || false);

  // 2. IPC - Modo Mini-Player Flotante (Widget PiP)
  let previousWindowBounds = { width: 1040, height: 720 };

  ipcMain.handle('ui:toggleMiniPlayer', (_, activar) => {
    if (!mainWindow) return false;
    if (activar) {
      previousWindowBounds = mainWindow.getBounds();
      mainWindow.setAlwaysOnTop(true, 'floating');
      mainWindow.setMinimumSize(340, 175);
      mainWindow.setSize(380, 185);
      mainWindow.setResizable(true);
    } else {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setMinimumSize(920, 620);
      const targetW = (previousWindowBounds && previousWindowBounds.width >= 920) ? previousWindowBounds.width : 1040;
      const targetH = (previousWindowBounds && previousWindowBounds.height >= 620) ? previousWindowBounds.height : 720;
      mainWindow.setSize(targetW, targetH);
      if (previousWindowBounds && previousWindowBounds.x !== undefined && previousWindowBounds.y !== undefined) {
        mainWindow.setPosition(previousWindowBounds.x, previousWindowBounds.y);
      }
      mainWindow.setResizable(true);
    }
    return Boolean(activar);
  });

  // 3. IPC - Persistencia de Datos (Compatible con AURA y legacy MVP)
  ipcMain.handle('datos:cargar', () => {
    try {
      if (fs.existsSync(archivoDatosAura)) {
        const raw = fs.readFileSync(archivoDatosAura, 'utf-8');
        const data = JSON.parse(raw);
        if (data.carpeta && fs.existsSync(data.carpeta)) {
          carpetaDescargasActual = data.carpeta;
        }
        return data;
      }
      // Si no existe, revisar si existe el json legacy
      if (fs.existsSync(archivoDatosLegacy)) {
        const rawLegacy = fs.readFileSync(archivoDatosLegacy, 'utf-8');
        const legacyData = JSON.parse(rawLegacy);
        if (legacyData.carpeta && fs.existsSync(legacyData.carpeta)) {
          carpetaDescargasActual = legacyData.carpeta;
        }
        return legacyData;
      }
    } catch (err) {
      console.error('[AURA Main] Error cargando datos guardados:', err);
    }

    return {
      carpeta: getDownloadFolder(),
      playlists: { Favoritas: [] }
    };
  });

  ipcMain.handle('datos:guardar', (_, nuevosDatos) => {
    try {
      fs.writeFileSync(archivoDatosAura, JSON.stringify(nuevosDatos, null, 2));
      if (nuevosDatos.carpeta) {
        carpetaDescargasActual = nuevosDatos.carpeta;
      }
      return true;
    } catch (err) {
      console.error('[AURA Main] Error guardando datos:', err);
      return false;
    }
  });

  // 4. IPC - Gestión de Archivos y Descargas Offline
  ipcMain.handle('archivo:seleccionarCarpeta', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Selecciona la carpeta para tu música de AURA',
      defaultPath: getDownloadFolder(),
      properties: ['openDirectory', 'createDirectory']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      carpetaDescargasActual = result.filePaths[0];
      return carpetaDescargasActual;
    }
    return getDownloadFolder();
  });

  ipcMain.handle('archivo:obtenerCarpeta', () => getDownloadFolder());

  ipcMain.handle('archivo:abrirCarpeta', () => {
    const folder = getDownloadFolder();
    shell.openPath(folder);
    return true;
  });

  ipcMain.handle('archivo:verificar', (_, titulo) => {
    try {
      const folder = getDownloadFolder();
      const ruta = resolveSafeTrackPath(folder, titulo);
      return fs.existsSync(ruta) ? ruta : null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('archivo:leerLocal', () => {
    try {
      const folder = getDownloadFolder();
      if (!fs.existsSync(folder)) return [];
      const archivos = fs.readdirSync(folder);
      return archivos
        .filter((f) => f.toLowerCase().endsWith('.mp3'))
        .map((f) => {
          const stats = fs.statSync(join(folder, f));
          const mb = (stats.size / (1024 * 1024)).toFixed(2);
          return {
            titulo: f.slice(0, -4),
            title: f.slice(0, -4),
            rutaAbsoluta: join(folder, f),
            url: `file:///${join(folder, f).replace(/\\/g, '/')}`,
            audioUrl: `file:///${join(folder, f).replace(/\\/g, '/')}`,
            sizeMb: `${mb} MB`,
            isLocal: true,
            channel: 'Música Local (Offline)'
          };
        });
    } catch (err) {
      console.error('[AURA Main] Error leyendo música local:', err);
      return [];
    }
  });

  ipcMain.handle('archivo:obtenerTamanioCarpeta', () => {
    try {
      const folder = getDownloadFolder();
      if (!fs.existsSync(folder)) return { bytes: 0, formateado: '0 MB' };
      let total = 0;
      const files = fs.readdirSync(folder);
      for (const f of files) {
        if (f.toLowerCase().endsWith('.mp3')) {
          const stats = fs.statSync(join(folder, f));
          total += stats.size;
        }
      }
      const mb = (total / (1024 * 1024)).toFixed(2);
      return { bytes: total, formateado: `${mb} MB` };
    } catch {
      return { bytes: 0, formateado: '0 MB' };
    }
  });

  ipcMain.handle('archivo:eliminar', (_, titulo) => {
    try {
      const folder = getDownloadFolder();
      const ruta = resolveSafeTrackPath(folder, titulo);
      if (fs.existsSync(ruta)) {
        fs.unlinkSync(ruta);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  });

  // 5. Descargar MP3 desde YouTube
  ipcMain.handle('youtube:descargar', async (_, { url, titulo }) => {
    try {
      if (!isValidYouTubeUrl(url)) {
        return { exito: false, error: 'URL de YouTube no válida o no permitida' };
      }

      const folder = getDownloadFolder();
      const rutaFinal = resolveSafeTrackPath(folder, titulo);

      // Usar youtube-dl-exec para descargar el audio en MP3 de máxima calidad
      await youtubedl(url, {
        extractAudio: true,
        audioFormat: 'mp3',
        output: rutaFinal,
        noWarnings: true,
        noCheckCertificate: true,
        noPlaylist: true
      });

      return { exito: true, ruta: rutaFinal };
    } catch (err) {
      console.error('[AURA Main] Error descargando audio:', err);
      return { exito: false, error: err.message || 'Fallo en la descarga' };
    }
  });

  createWindow();
  createTray();
  registerGlobalShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
