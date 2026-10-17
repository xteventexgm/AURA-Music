/**
 * AURA Music - Configuración y Gestión de Llaves de API
 * Mantiene la rotación automática de llaves para evitar límites de cuota (429/403).
 */

const STORAGE_KEYS = {
  RAPID_API: 'aura_rapid_api_keys',
  YOUTUBE_API: 'aura_youtube_api_key'
};

// Llaves de respaldo por defecto verificadas y activas
export const DEFAULT_RAPID_KEYS = [
  '2dd1b04385msh1bc56d17543f5e5p1b84a0jsn4fc3c347c60c',
  'edc0e2b0e3msha7e6d26938d2acfp10432cjsn78b51c5f8b30',
  '9f85584960msha701e1cedb5919cp1622acjsn80c0f3ccc86e',
  '63a6a44f0dmshc719d6f250cee76p1a1d68jsn36406a186236'
];

export const DEFAULT_YOUTUBE_KEY = 'AIzaSyCg19z6JcQGpRHAXkIv65pHKT5dZfwFX4U';
export const RAPID_API_HOST = 'youtube-mp36.p.rapidapi.com';

let currentRapidKeys = [];
let currentRapidIndex = 0;
let currentYoutubeKey = DEFAULT_YOUTUBE_KEY;

export function initConfig() {
  try {
    const savedRapid = localStorage.getItem(STORAGE_KEYS.RAPID_API);
    if (savedRapid) {
      const parsed = JSON.parse(savedRapid);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const INVALID_KEYS = [
          '6c86310b16mshb70def43c1f5742p1e208fjsn44350803e21',
          '38922b1fcbmshf564bafab7c7fe3p1c0b5djsn8053c1f76a5'
        ];
        currentRapidKeys = parsed.filter((k) => !INVALID_KEYS.includes(k));
        if (currentRapidKeys.length === 0) currentRapidKeys = [...DEFAULT_RAPID_KEYS];
      } else {
        currentRapidKeys = [...DEFAULT_RAPID_KEYS];
      }
    } else {
      currentRapidKeys = [...DEFAULT_RAPID_KEYS];
    }

    const savedYt = localStorage.getItem(STORAGE_KEYS.YOUTUBE_API);
    if (savedYt && savedYt.trim()) {
      currentYoutubeKey = savedYt.trim();
    } else {
      currentYoutubeKey = DEFAULT_YOUTUBE_KEY;
    }
  } catch (e) {
    console.warn('[Config] Error cargando llaves, usando por defecto:', e);
    currentRapidKeys = [...DEFAULT_RAPID_KEYS];
    currentYoutubeKey = DEFAULT_YOUTUBE_KEY;
  }
}

export function getRapidApiKeys() {
  return [...currentRapidKeys];
}

export function getActiveRapidKey() {
  if (currentRapidKeys.length === 0) return null;
  return currentRapidKeys[currentRapidIndex % currentRapidKeys.length];
}

export function rotateRapidKey() {
  if (currentRapidKeys.length === 0) return null;
  currentRapidIndex = (currentRapidIndex + 1) % currentRapidKeys.length;
  console.log(`[Config] Rotando a RapidAPI Key index: ${currentRapidIndex + 1}/${currentRapidKeys.length}`);
  return getActiveRapidKey();
}

export function addRapidApiKey(newKey) {
  const trimmed = newKey.trim();
  if (!trimmed || currentRapidKeys.includes(trimmed)) return false;
  currentRapidKeys.push(trimmed);
  saveRapidKeys();
  return true;
}

export function removeRapidApiKey(index) {
  if (index >= 0 && index < currentRapidKeys.length) {
    currentRapidKeys.splice(index, 1);
    currentRapidIndex = 0;
    saveRapidKeys();
    return true;
  }
  return false;
}

export function resetRapidApiKeys() {
  currentRapidKeys = [...DEFAULT_RAPID_KEYS];
  currentRapidIndex = 0;
  saveRapidKeys();
}

function saveRapidKeys() {
  localStorage.setItem(STORAGE_KEYS.RAPID_API, JSON.stringify(currentRapidKeys));
}

export function getYoutubeApiKey() {
  return currentYoutubeKey;
}

export function setYoutubeApiKey(key) {
  const trimmed = key.trim();
  if (!trimmed) return false;
  currentYoutubeKey = trimmed;
  localStorage.setItem(STORAGE_KEYS.YOUTUBE_API, trimmed);
  return true;
}

export function resetYoutubeApiKey() {
  currentYoutubeKey = DEFAULT_YOUTUBE_KEY;
  localStorage.removeItem(STORAGE_KEYS.YOUTUBE_API);
}
