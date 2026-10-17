import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

const api = {
  // Controles de Ventana (Custom Titlebar)
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowStateChange: (callback) => {
    ipcRenderer.on('window:stateChange', (_, data) => callback(data));
  },

  // Controles Multimedia del Sistema (Tray & Global Shortcuts)
  onMediaAction: (callback) => {
    ipcRenderer.on('media:togglePlay', () => callback('togglePlay'));
    ipcRenderer.on('media:next', () => callback('next'));
    ipcRenderer.on('media:prev', () => callback('prev'));
  },

  // Modo Mini-Player Flotante
  toggleMiniPlayer: (activar) => ipcRenderer.invoke('ui:toggleMiniPlayer', activar),

  // Almacenamiento Persistente en Disco
  cargarDatosLocales: () => ipcRenderer.invoke('datos:cargar'),
  guardarDatosLocales: (datos) => ipcRenderer.invoke('datos:guardar', datos),

  // Gestión de Archivos y Descargas Offline
  seleccionarCarpeta: () => ipcRenderer.invoke('archivo:seleccionarCarpeta'),
  obtenerCarpeta: () => ipcRenderer.invoke('archivo:obtenerCarpeta'),
  abrirCarpeta: () => ipcRenderer.invoke('archivo:abrirCarpeta'),
  obtenerMusicaLocal: () => ipcRenderer.invoke('archivo:leerLocal'),
  verificarDescarga: (titulo) => ipcRenderer.invoke('archivo:verificar', titulo),
  eliminarArchivo: (titulo) => ipcRenderer.invoke('archivo:eliminar', titulo),
  obtenerTamanioCarpeta: () => ipcRenderer.invoke('archivo:obtenerTamanioCarpeta'),
  descargarMusica: (datos) => ipcRenderer.invoke('youtube:descargar', datos),

  isDesktop: true
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('auraDesktop', api);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error('[AURA Preload] Error exponiendo APIs:', error);
  }
} else {
  window.electron = electronAPI;
  window.auraDesktop = api;
  window.api = api;
}
