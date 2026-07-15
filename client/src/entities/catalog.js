// Original fictional vehicle & weapon rosters. Adler Motors = the game's
// European-performance marque (no real-world brands or designs).

export const VEHICLES = {
  falke: {
    name: 'Adler Falke S', cls: 'super', price: 235000,
    mass: 1350, engine: 9200, maxSpeed: 86, slip: 5.4, brake: 110,
    size: [2.02, 0.98, 4.5], wheelR: 0.36,
    sus: { stiff: 60, travel: 0.16, rest: 0.24 }, downforce: 22, steer: 1.05,
    body: 'wedge', paint: '#c8ccd4',
  },
  kurier: {
    name: 'Adler Kurier RS', cls: 'sedan', price: 92000,
    mass: 1620, engine: 7200, maxSpeed: 73, slip: 4.6, brake: 100,
    size: [1.95, 1.28, 4.7], wheelR: 0.36,
    sus: { stiff: 42, travel: 0.22, rest: 0.3 }, downforce: 10,
    body: 'sedan', paint: '#0f2f6b',
  },
  stadt: {
    name: 'Adler Stadt', cls: 'compact', price: 17500,
    mass: 1180, engine: 4300, maxSpeed: 52, slip: 3.9, brake: 80,
    size: [1.78, 1.4, 3.9], wheelR: 0.32,
    sus: { stiff: 34, travel: 0.26, rest: 0.32 },
    body: 'hatch', paint: '#8a0f1a',
  },
  thunder: {
    name: 'Kestrel Thunderhead', cls: 'muscle', price: 64000,
    mass: 1760, engine: 8600, maxSpeed: 76, slip: 3.5, brake: 92,
    size: [2.0, 1.24, 5.0], wheelR: 0.38,
    sus: { stiff: 38, travel: 0.24, rest: 0.32 }, drift: true,
    body: 'muscle', paint: '#1b1e24',
  },
  steinbock: {
    name: 'Steinbock TK-4', cls: 'offroad', price: 47000,
    mass: 2150, engine: 6800, maxSpeed: 57, slip: 5.0, brake: 95,
    size: [2.1, 1.7, 4.9], wheelR: 0.5,
    sus: { stiff: 26, travel: 0.42, rest: 0.48 },
    body: 'pickup', paint: '#2e6b31',
  },
  vagon: {
    name: 'Vesna Vagon', cls: 'van', price: 24000,
    mass: 2250, engine: 5200, maxSpeed: 46, slip: 4.2, brake: 85,
    size: [2.1, 2.1, 5.4], wheelR: 0.4,
    sus: { stiff: 30, travel: 0.3, rest: 0.36 },
    body: 'van', paint: '#c9bfa8',
  },
  taxi: {
    name: 'Stadt Taxi', cls: 'compact', price: 0, noSale: true,
    mass: 1200, engine: 4600, maxSpeed: 54, slip: 4.0, brake: 82,
    size: [1.8, 1.42, 4.1], wheelR: 0.32,
    sus: { stiff: 34, travel: 0.26, rest: 0.32 },
    body: 'sedan', paint: '#e8b437', taxi: true,
  },
  cruiser: {
    name: 'NBPD Interceptor', cls: 'police', price: 0, noSale: true, cop: true,
    mass: 1680, engine: 8000, maxSpeed: 78, slip: 4.9, brake: 105,
    size: [1.98, 1.3, 4.8], wheelR: 0.37,
    sus: { stiff: 44, travel: 0.24, rest: 0.3 }, downforce: 8,
    body: 'sedan', paint: '#14161c', police: true,
  },
  sturm: {
    name: 'NBPD Sturm', cls: 'swat', price: 0, noSale: true, cop: true,
    mass: 3400, engine: 7600, maxSpeed: 55, slip: 4.6, brake: 100,
    size: [2.3, 2.3, 6.0], wheelR: 0.46, health: 220,
    sus: { stiff: 40, travel: 0.3, rest: 0.36 },
    body: 'van', paint: '#16181e', police: true,
  },
  geldwagen: {
    name: 'Geldwagen GS', cls: 'armored', price: 0, noSale: true,
    mass: 3200, engine: 6400, maxSpeed: 48, slip: 4.4, brake: 95,
    size: [2.25, 2.2, 5.8], wheelR: 0.44, health: 260,
    sus: { stiff: 38, travel: 0.3, rest: 0.36 },
    body: 'van', paint: '#8d9299',
  },
};

// what drives around as ambient traffic (weighted)
export const TRAFFIC_POOL = [
  'stadt', 'stadt', 'stadt', 'kurier', 'kurier', 'taxi', 'taxi',
  'thunder', 'steinbock', 'vagon', 'falke',
];
export const PARKED_POOL = ['stadt', 'kurier', 'thunder', 'steinbock', 'vagon', 'stadt'];

export const TRAFFIC_COLORS = [
  '#c8ccd4', '#1b1e24', '#8a0f1a', '#0f2f6b', '#5c6470', '#ffffff',
  '#2e6b31', '#d4552a', '#3a3f4a', '#7a7f88', '#563a6b',
];

export const WEAPONS = {
  fist:   { name: 'Fists', melee: true, dmg: 12, rate: 2.6, range: 1.9, auto: false },
  bat:    { name: 'Cracker Bat', melee: true, dmg: 30, rate: 1.9, range: 2.3, auto: false, price: 300 },
  pistol: { name: 'Rook 9', dmg: 17, rate: 5, mag: 12, spread: 0.014, range: 90, auto: false,
            reload: 1.3, price: 1200, ammoPrice: 60, ammoPack: 24, kick: 0.011 },
  smg:    { name: 'Hornet SF', dmg: 11, rate: 11, mag: 30, spread: 0.036, range: 70, auto: true,
            reload: 1.8, price: 6500, ammoPrice: 150, ammoPack: 60, kick: 0.007 },
  shotgun:{ name: 'Boxer 12', dmg: 9, pellets: 7, rate: 1.1, mag: 8, spread: 0.07, range: 32,
            auto: false, reload: 2.4, price: 4200, ammoPrice: 120, ammoPack: 16, kick: 0.03 },
  rifle:  { name: 'Lancer 51', dmg: 24, rate: 7.5, mag: 30, spread: 0.009, range: 140, auto: true,
            reload: 2.1, price: 14500, ammoPrice: 260, ammoPack: 60, kick: 0.012 },
  grenade:{ name: 'Pipe Charge', thrown: true, dmg: 130, radius: 7.5, fuse: 2.4, rate: 0.8,
            price: 900, ammoPrice: 900, ammoPack: 3 },
};
export const WEAPON_ORDER = ['fist', 'bat', 'pistol', 'smg', 'shotgun', 'rifle', 'grenade'];

export const PED_OUTFITS = [
  { shirt: '#8a4a3a', pants: '#2c3038', skin: '#c89878' },
  { shirt: '#3a5a8a', pants: '#22242a', skin: '#8a5c3c' },
  { shirt: '#4a7a4a', pants: '#4a4640', skin: '#e8c098' },
  { shirt: '#7a3a6a', pants: '#30343c', skin: '#6b4226' },
  { shirt: '#c8b040', pants: '#3c3630', skin: '#d8a880' },
  { shirt: '#d8d8d8', pants: '#26282e', skin: '#b08058' },
  { shirt: '#e8e0d0', pants: '#5a4632', skin: '#f0d0a8' },
  { shirt: '#2a8a8a', pants: '#1e2026', skin: '#96603a' },
];
export const COP_OUTFIT = { shirt: '#1d2b4a', pants: '#14161c', skin: '#c89878', cap: '#101828' };
export const SWAT_OUTFIT = { shirt: '#181a20', pants: '#14161a', skin: '#c89878', cap: '#0c0e14' };
export const CLERK_OUTFIT = { shirt: '#4a7a5a', pants: '#2c3038', skin: '#d0a070', apron: true };
