// Global configuration + user settings (persisted to localStorage).

const params = new URLSearchParams(location.search);

function detectApiBase() {
  if (import.meta.env && import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
  if (location.protocol === 'file:') return 'http://127.0.0.1:8177/api';
  return '/api';
}

const DEFAULT_SETTINGS = {
  quality: 'high',          // low | medium | high
  drawDistance: 2,          // chunk radius (chunks are 240 m)
  resolutionScale: 1.0,
  fov: 70,
  aimAssist: true,
  invertY: false,
  volMaster: 0.8,
  volMusic: 0.65,
  volSfx: 0.9,
  dayLengthMin: 20,         // real minutes per in-game 24 h
  showFps: false,
  cameraShake: true,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem('gta.settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) { /* private mode etc. */ }
  return { ...DEFAULT_SETTINGS };
}

export const CFG = {
  version: '0.1.0',
  title: 'GRAND THEFT AUDI',
  city: 'Neustadt Bay',
  apiBase: detectApiBase(),
  profile: 'default',
  smoke: params.has('smoke'),
  autostart: params.has('autostart') || params.has('smoke'),
  urlQuality: params.get('quality'),
  urlHour: params.get('hour'),
  urlWeather: params.get('weather'),
  settings: loadSettings(),

  // gameplay tuning
  gravity: -14,
  physicsStep: 1 / 60,
  pedTarget: 26,
  trafficTarget: 14,
  parkedPerBlock: 2,
  maxRagdolls: 6,
  maxCopCars: 7,
  wastedPenalty: 0.1,
  bustedPenalty: 0.1,
};

if (CFG.urlQuality) CFG.settings.quality = CFG.urlQuality;
if (CFG.smoke) {
  CFG.settings.quality = 'low';
  CFG.settings.drawDistance = 1;
  CFG.settings.resolutionScale = 0.5;
  CFG.settings.volMaster = 0;
}
if (CFG.urlQuality) CFG.settings.quality = CFG.urlQuality; // explicit beats smoke default
if (params.get('rs')) CFG.settings.resolutionScale = parseFloat(params.get('rs'));
CFG.urlSpawn = params.get('px') !== null && params.get('pz') !== null
  ? { x: parseFloat(params.get('px')), z: parseFloat(params.get('pz')), yaw: parseFloat(params.get('yaw') ?? '0'), noCar: params.has('nocar') }
  : null;

export function saveSettings() {
  try { localStorage.setItem('gta.settings', JSON.stringify(CFG.settings)); } catch (e) { /* ignore */ }
}

export const COLORS = {
  paints: [
    '#c8ccd4', '#1b1e24', '#8a0f1a', '#0f2f6b', '#e8b437', '#2e6b31',
    '#ffffff', '#5c6470', '#7a2d8a', '#d4552a', '#0e8a8a', '#c2185b',
  ],
};
