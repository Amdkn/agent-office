import * as THREE from 'three';
import { ELEVATOR, ELEVATOR_FRONT, FLOOR, ROAD, SLAB, STREET_Y, WALL_T } from '../../shared/layout';
import { LOT, SIDE_LOT } from '../../shared/garage';
import { STREET_END, shoreX } from '../../shared/scenic';
import type { Collider } from './types';
import type { Fixture, StreetSite } from './office/fixture';
import { canvasTexture } from './texture';
import { mergeByMaterial, mesh, textPlane, toon, toonUnique } from './toon';

const G = STREET_Y;
/** The building's footprint, walls included. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;
/** Parking bays are this wide; the rows of them start at x = -16. */
const BAY = 3.2;

/** A light that throws a pool of light around it at night (see sky.ts): where, how far, and its color. */
export interface Lamp {
  x: number;
  y: number;
  z: number;
  reach: number;
  color: string;
  /** How bright, at the middle of the pool. */
  power: number;
  /** Down by the street (a street lamp, the one over the exit): it's further down the higher your floor is. */
  ground?: boolean;
}

/** Everything that changes between day and night and with the weather, for the sky to drive. */
export interface NightParts {
  /** Bulbs whose glow goes from `day` (emissive intensity by day) up to full at night. */
  bulbs: { mat: THREE.MeshToonMaterial; day: number }[];
  /** Where each bulb's soft halo goes at night, and its color; `ground` as for a Lamp. */
  halos: { at: THREE.Vector3; size: number; color: string; ground?: boolean }[];
  lamps: Lamp[];
  /** How far below the floor you're on the street is (see streetBelow): what the `ground` lamps drop with. */
  street: number;
  /** The neighbours' walls, whose windows light up at night. */
  windows: THREE.MeshToonMaterial[];
  clouds: THREE.MeshToonMaterial;
  /** Rain running down the office windows. */
  wetGlass: THREE.MeshBasicMaterial;
  /** Light you only see at night (the lighthouse's beam): see-through, `max` opaque when it's dark. */
  glows: { mat: THREE.Material; max: number }[];
}

/** A bulb that glows `day` much by day and fully at night. */
export function bulb(night: NightParts, color: string, day = 0): THREE.MeshToonMaterial {
  const mat = toonUnique(color);
  mat.emissive.set(color);
  mat.emissiveIntensity = day;
  night.bulbs.push({ mat, day });
  return mat;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** A flat, textured toon plane lying on the ground. */
function groundPlane(w: number, d: number, x: number, y: number, z: number, map: THREE.Texture | null, color = '#ffffff'): THREE.Mesh {
  const mat = new THREE.MeshToonMaterial({ color, map, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

/**
 * Polished concrete with painted bays along the back wall and along the front, and a hatched box
 * to keep clear in front of the elevator, which takes up a bay at the back.
 */
function garageFloorTexture(): THREE.CanvasTexture {
  const w = B.maxX - B.minX;
  const d = B.maxZ - B.minZ;
  const px = 32; // pixels per meter
  return canvasTexture(Math.round(w * px), Math.round(d * px), (g) => {
    g.fillStyle = '#c9ccd4';
    g.fillRect(0, 0, w * px, d * px);
    // A few darker blotches, so it isn't a flat slab.
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(90, 96, 110, ${0.015 + Math.random() * 0.025})`;
      g.beginPath();
      g.ellipse(Math.random() * w * px, Math.random() * d * px, 10 + Math.random() * 30, 6 + Math.random() * 20, Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
    const X = (x: number) => (x - B.minX) * px;
    const Z = (z: number) => (z - B.minZ) * px;
    const lift = { minX: ELEVATOR.x - ELEVATOR.width / 2, maxX: ELEVATOR.x + ELEVATOR.width / 2, minZ: ELEVATOR_FRONT, maxZ: ELEVATOR_FRONT + 2.2 };
    g.fillStyle = '#fffaf0';
    for (const [z0, z1] of [
      [B.minZ + 0.3, B.minZ + 5.8],
      [B.maxZ - 5.8, B.maxZ - 0.3],
    ]) {
      for (let x = -16; x <= 16.01; x += BAY) {
        // Not out of the elevator's shaft and across the box in front of it.
        if (z0 < lift.maxZ && x > lift.minX - 0.1 && x < lift.maxX + 0.1) continue;
        g.fillRect(X(x) - 2, Z(z0), 4, (z1 - z0) * px);
      }
    }
    // The box in front of the elevator's doors: a yellow outline, hatched across.
    g.save();
    g.beginPath();
    g.rect(X(lift.minX), Z(lift.minZ), (lift.maxX - lift.minX) * px, (lift.maxZ - lift.minZ) * px);
    g.clip();
    g.strokeStyle = '#ffd166';
    g.lineWidth = 7;
    for (let d = -3; d < 6; d += 0.45) {
      g.beginPath();
      g.moveTo(X(lift.minX + d), Z(lift.minZ));
      g.lineTo(X(lift.minX + d + 3), Z(lift.maxZ));
      g.stroke();
    }
    g.restore();
    g.strokeStyle = '#ffd166';
    g.lineWidth = 8;
    g.strokeRect(X(lift.minX) + 4, Z(lift.minZ) + 4, (lift.maxX - lift.minX) * px - 8, (lift.maxZ - lift.minZ) * px - 8);
    // Arrows down the aisle, pointing out to the street.
    g.fillStyle = '#ffd166';
    for (const x of [-8, 8]) {
      const cx = X(x);
      const cz = Z(0);
      g.fillRect(cx - 5, cz - 60, 10, 90);
      g.beginPath();
      g.moveTo(cx - 22, cz + 30);
      g.lineTo(cx + 22, cz + 30);
      g.lineTo(cx, cz + 62);
      g.closePath();
      g.fill();
    }
  });
}

/**
 * Downstairs: the open garage under the office's floor slab (see world/stack.ts): concrete
 * walls at the back and on the west side, columns along the open front and east side, and strip
 * lights. The Lambos and Ferraris parked in it are features/cars/world.ts's.
 */
export function buildGarage(group: THREE.Group, colliders: Collider[]) {
  const w = B.maxX - B.minX;
  const d = B.maxZ - B.minZ;
  const cx = (B.minX + B.maxX) / 2;
  const cz = (B.minZ + B.maxZ) / 2;
  const ceiling = -SLAB;
  const concrete = toon('#d3d6dd');
  // The slab over it, which is the office's floor, is world/stack.ts's: holes go through it to the floor below.

  group.add(groundPlane(w, d, cx, G + 0.004, cz, garageFloorTexture()));

  // The back and west walls, with a yellow band along them, and the columns and lights: all merged at the end.
  const parts = new THREE.Group();
  const wallH = ceiling - G;
  const yellow = toon('#ffd166');
  const walls: [number, number, number, number][] = [
    [B.minX, B.maxX, B.minZ, B.minZ + WALL_T],
    [B.minX, B.minX + WALL_T, B.minZ, B.maxZ],
  ];
  for (const [x0, x1, z0, z1] of walls) {
    parts.add(mesh(box(x1 - x0, wallH, z1 - z0), concrete, (x0 + x1) / 2, G + wallH / 2, (z0 + z1) / 2));
    parts.add(mesh(box(x1 - x0 + 0.02, 0.35, z1 - z0 + 0.02), yellow, (x0 + x1) / 2, G + 1.1, (z0 + z1) / 2, false));
    colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, bottom: G, top: ceiling });
  }
  const sign = textPlane('🏎️  GARAGE', { bg: '#2b2d42', color: '#ffd166', size: 64, border: '#ffd166' });
  sign.scale.multiplyScalar(1.6);
  sign.position.set(0, G + 2.3, B.minZ + WALL_T + 0.02);
  group.add(sign);

  // Columns holding up the office, along the open sides and down the middle.
  const cols: [number, number][] = [];
  for (const x of [B.maxX - 0.25, -9.6, 0, 9.6]) cols.push([x, B.maxZ - 0.25], [x, 0]);
  cols.push([B.maxX - 0.25, -6.5], [B.maxX - 0.25, 6.5], [B.maxX - 0.25, B.minZ + 0.25]);
  const colMat = toon('#e6e8ee');
  for (const [x, z] of cols) {
    parts.add(mesh(box(0.5, wallH, 0.5), colMat, x, G + wallH / 2, z));
    parts.add(mesh(box(0.52, 0.5, 0.52), yellow, x, G + 0.25, z, false));
    colliders.push({ minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25, bottom: G, top: ceiling });
  }

  // Strip lights on the ceiling.
  const light = toon('#ffffff', { emissive: '#fff4d6' });
  for (const x of [-13, -4.8, 4.8, 13]) for (const z of [-4.5, 4.5]) parts.add(mesh(box(2.6, 0.07, 0.22), light, x, ceiling - 0.04, z, false));
  group.add(mergeByMaterial(parts));
}

export function tree(scale: number): THREE.Group {
  const t = new THREE.Group();
  t.add(mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.2, 8), toon('#8a5a3b'), 0, 1.1, 0));
  t.add(mesh(new THREE.SphereGeometry(1.6, 12, 10), toon('#5fb760'), 0, 3.2, 0));
  t.add(mesh(new THREE.SphereGeometry(1.1, 12, 10), toon('#3f8f45'), 0.8, 3.9, 0.4));
  t.add(mesh(new THREE.SphereGeometry(1.0, 12, 10), toon('#6fcf6a'), -0.7, 3.8, -0.3));
  t.scale.setScalar(scale);
  return t;
}

/** A building across the street or out back: a painted block with rows of windows and a roof cap. */
function building(w: number, h: number, d: number, color: string, lit: THREE.MeshToonMaterial[]): THREE.Group {
  const g = new THREE.Group();
  // Where the windows go across a floor (in 256ths): each column's middle half, 70 to 190 up.
  const face = (n: number) =>
    canvasTexture(256, 256, (c) => {
      c.fillStyle = color;
      c.fillRect(0, 0, 256, 256);
      c.fillStyle = '#bfe3ff';
      for (let i = 0; i < n; i++) c.fillRect(((i + 0.25) / n) * 256, 70, (0.5 / n) * 256, 120);
      c.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < n; i++) c.fillRect(((i + 0.25) / n) * 256, 70, (0.12 / n) * 256, 120);
    });
  // At night about half of them are lit: lamps, a ceiling light, the odd TV.
  const lights = (n: number, floors: number) =>
    canvasTexture(64, 64 * floors, (c) => {
      c.fillStyle = '#000000';
      c.fillRect(0, 0, 64, 64 * floors);
      for (let f = 0; f < floors; f++) {
        for (let i = 0; i < n; i++) {
          if (Math.random() < 0.45) continue;
          c.fillStyle = Math.random() < 0.15 ? '#9ec9ff' : Math.random() < 0.5 ? '#ffd27a' : '#ffe6b0';
          c.fillRect(((i + 0.25) / n) * 64, f * 64 + (70 / 256) * 64, (0.5 / n) * 64, (120 / 256) * 64);
        }
      }
    });
  const floors = Math.max(1, Math.round(h / 3.2));
  const walls = (span: number) => {
    const n = Math.max(1, Math.round(span / 2.6));
    const t = face(n);
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, floors);
    const m = new THREE.MeshToonMaterial({ map: t, emissive: '#ffffff', emissiveMap: lights(n, floors), emissiveIntensity: 0, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
    lit.push(m);
    return m;
  };
  const sides = walls(d);
  const fronts = walls(w);
  const mats = [sides, sides, toon(color), toon(color), fronts, fronts];
  g.add(new THREE.Mesh(box(w, h, d), mats));
  (g.children[0] as THREE.Mesh).position.y = h / 2;
  (g.children[0] as THREE.Mesh).castShadow = true;
  g.add(mesh(box(w + 0.4, 0.4, d + 0.4), toon('#fffaf3'), 0, h + 0.2, 0));
  return g;
}

/** A street lamp on the sidewalk at (x, z), its arm reaching out over the road toward `toward` (±1 in z). */
export function streetLamp(parts: THREE.Group, night: NightParts, glass: THREE.MeshToonMaterial, colliders: Collider[], x: number, z: number, toward: number) {
  const ink = toon('#3d405b');
  const H = 5;
  parts.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.5, 10), ink, x, G + 0.25, z));
  parts.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, H, 8), ink, x, G + H / 2, z));
  parts.add(mesh(box(0.08, 0.08, 1.3), ink, x, G + H - 0.05, z + toward * 0.6));
  const hz = z + toward * 1.2;
  parts.add(mesh(new THREE.CylinderGeometry(0.12, 0.42, 0.26, 12), ink, x, G + H - 0.1, hz));
  parts.add(mesh(new THREE.SphereGeometry(0.22, 12, 8), glass, x, G + H - 0.3, hz, false));
  colliders.push({ minX: x - 0.2, maxX: x + 0.2, minZ: z - 0.2, maxZ: z + 0.2, bottom: G, top: G + H });
  night.halos.push({ at: new THREE.Vector3(x, G + H - 0.34, hz), size: 2.4, color: '#ffd89a', ground: true });
  night.lamps.push({ x, y: G + H - 0.6, z: hz, reach: 10, color: '#ffcf8a', power: 4, ground: true });
}

/**
 * How far the grass goes, every way from the office: from the top floor the haze is up to HAZE_MAX
 * off (see world/sky.ts), and out at the far corners of the scenic loop too, so its edges must be
 * further than that even at the edge of the view. To the west it stops at the beach (world/scenic/).
 */
const REACH = 900;
/** Where the grass stops to the west, under the beach's sand, whose flat top is everywhere past here. */
const LAWN_WEST = Math.ceil(Math.max(...Array.from({ length: 1801 }, (_, i) => shoreX(i - 900))) + 4);

/** The street's asphalt: white lines along its edges and a dashed yellow one down the middle, 8 m to a dash and a gap. */
export function roadTexture(): THREE.CanvasTexture {
  const road = canvasTexture(256, 128, (g) => {
    g.fillStyle = '#5b606c';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#f1f1f1';
    g.fillRect(0, 6, 256, 4);
    g.fillRect(0, 118, 256, 4);
    g.fillStyle = '#ffd166';
    g.fillRect(0, 61, 150, 6);
  });
  road.wrapS = THREE.RepeatWrapping;
  return road;
}

/**
 * The neighbours' buildings: [x, z, width, height, depth, paint], across the street and further out
 * behind and beside the office. The gap across the street from the balcony is the golf hole's
 * (GOLF_HOLE in layout).
 */
const NEIGHBOURS: [number, number, number, number, number, string][] = [
  [-38, 45, 12, 10, 9, '#8ecae6'],
  [-22, 46, 14, 16, 10, '#ffb4a2'],
  [12, 47, 16, 19, 12, '#cdb4db'],
  [30, 45, 12, 9, 9, '#ffd6a5'],
  [-20, -42, 18, 14, 10, '#a2d2ff'],
  [8, -44, 16, 20, 12, '#f4acb7'],
  [-48, -6, 10, 12, 16, '#ffe5b4'],
  [50, 4, 10, 15, 18, '#bde0fe'],
];

/** Which way a neighbour at (x, z) is turned: its front to the office. */
const facing = (x: number, z: number) => (Math.abs(x) > 40 ? (x > 0 ? -Math.PI / 2 : Math.PI / 2) : z > 0 ? Math.PI : 0);

/** The CubeFarm · City Office building across the street at (x=12, z=47), with ground-floor patio, glass doors and illuminated signage. */
function buildCubeFarmBuilding(group: THREE.Group, colliders: Collider[], night: NightParts) {
  const x = 12;
  const z = 47;
  const w = 16;
  const h = 19;
  const d = 12;
  const frontZ = z - d / 2; // 41.0 (faces north toward Agent-Office & Scenic Loop)

  const b = building(w, h, d, '#fbf3e4', night.windows);
  b.position.set(x, G, z);
  b.rotation.y = facing(x, z);
  group.add(b);

  const cf = new THREE.Group();
  const coral = toon('#ff8a5b');
  const ink = toon('#1f1d2b');
  const patioMat = toon('#e3b98f');
  const frameMat = toon('#e9ecef');
  const glassMat = toon('#bfe3ff');
  const railMat = toon('#5c677d');
  const planterMat = toon('#e07a5f');
  const shrubMat = toon('#52b788');

  // Coral floor bands across the 6 floors of CubeFarm
  for (let f = 1; f <= 6; f++) {
    const fy = G + (f * h) / 6;
    cf.add(mesh(box(w + 0.16, 0.22, d + 0.16), coral, x, fy, z, false));
  }
  cf.add(mesh(box(w + 0.5, 0.45, d + 0.5), ink, x, G + h + 0.22, z, false));

  // Ground-floor patio slab extending from frontZ (41.0) out to z = 38.6
  cf.add(mesh(box(w, 0.14, 2.4), patioMat, x, G + 0.07, frontZ - 1.2));
  // Entrance walkway carpet leading from the sidewalk (z = 37.2) through the patio gate
  cf.add(mesh(box(3.4, 0.06, 3.8), coral, x, G + 0.03, frontZ - 1.9, false));

  // Patio railing along z = 38.65 with a wide 3.6m open gate in the middle (x = 10.2..13.8)
  for (const [rx0, rx1] of [
    [x - w / 2 + 0.2, x - 1.8],
    [x + 1.8, x + w / 2 - 0.2],
  ]) {
    const rw = rx1 - rx0;
    const rcx = (rx0 + rx1) / 2;
    cf.add(mesh(box(rw, 0.08, 0.08), railMat, rcx, G + 1.05, frontZ - 2.32));
    cf.add(mesh(box(rw, 0.78, 0.04), glassMat, rcx, G + 0.55, frontZ - 2.32, false));
    colliders.push({ minX: rx0, maxX: rx1, minZ: frontZ - 2.4, maxZ: frontZ - 2.24, bottom: G, top: G + 1.15 });
  }

  // Two coral planters with shrubs flanking the patio entrance gate
  for (const px of [x - 2.5, x + 2.5]) {
    cf.add(mesh(box(0.9, 0.55, 0.9), planterMat, px, G + 0.34, frontZ - 1.7));
    cf.add(mesh(new THREE.SphereGeometry(0.48, 12, 10), shrubMat, px, G + 0.85, frontZ - 1.7));
  }

  // Sliding double glass entrance doors at (x = 12, z = 40.92)
  cf.add(mesh(box(3.2, 2.8, 0.14), ink, x, G + 1.45, frontZ - 0.05));
  for (const dx of [-0.72, 0.72]) {
    cf.add(mesh(box(1.32, 2.5, 0.18), glassMat, x + dx, G + 1.38, frontZ - 0.08, false));
    cf.add(mesh(box(1.38, 2.58, 0.16), frameMat, x + dx, G + 1.38, frontZ - 0.06, false));
  }

  // Entrance canopy & warm night halo
  cf.add(mesh(box(5.6, 0.24, 1.8), ink, x, G + 3.25, frontZ - 0.85));
  cf.add(mesh(box(5.66, 0.08, 1.86), coral, x, G + 3.38, frontZ - 0.85, false));
  const entranceLight = bulb(night, '#fff3d6', 0.4);
  cf.add(mesh(box(1.8, 0.08, 0.5), entranceLight, x, G + 3.1, frontZ - 0.85, false));
  night.halos.push({ at: new THREE.Vector3(x, G + 2.9, frontZ - 1.0), size: 3.2, color: '#ffd89a', ground: true });
  night.lamps.push({ x, y: G + 3.0, z: frontZ - 1.2, reach: 12, color: '#ffcf8a', power: 5, ground: true });

  group.add(mergeByMaterial(cf));

  // High-contrast signs facing north (rotation.y = Math.PI) toward Agent-Office & the street
  const mainSign = textPlane('✻ CUBEFARM · CITY OFFICE (6 FLOORS)', { bg: '#1f1d2b', color: '#ffd166', size: 64, border: '#ff8a5b' });
  mainSign.scale.multiplyScalar(1.65);
  mainSign.position.set(x, G + 4.25, frontZ - 0.9);
  mainSign.rotation.y = Math.PI;
  group.add(mainSign);

  const doorSign = textPlane('🏢 ENTRÉE LOBBY CUBEFARM · [E] ou Avancer', { bg: '#20224a', color: '#a8dadc', size: 52, border: '#ff8a5b' });
  doorSign.scale.multiplyScalar(1.1);
  doorSign.position.set(x, G + 2.55, frontZ - 0.18);
  doorSign.rotation.y = Math.PI;
  group.add(doorSign);
}

/** The neighbours' footprints, and how tall each stands (roof cap included) above the street. */
export function neighbourBoxes(): { minX: number; maxX: number; minZ: number; maxZ: number; top: number }[] {
  return NEIGHBOURS.map(([x, z, w, h, d]) => {
    // Turned a quarter, its width runs along z.
    const [hx, hz] = Math.abs(Math.sin(facing(x, z))) > 0.5 ? [d / 2, w / 2] : [w / 2, d / 2];
    return { minX: x - hx - 0.2, maxX: x + hx + 0.2, minZ: z - hz - 0.2, maxZ: z + hz + 0.2, top: h + 0.4 };
  });
}

/**
 * Everything outside, down on the street: grass, the lot in front of the garage, a road with
 * sidewalks and street lamps, trees and neighbours' buildings, and in `sky` some clouds.
 */
export function buildStreet(group: THREE.Group, colliders: Collider[], night: NightParts, sky: THREE.Group) {
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(REACH - LAWN_WEST, REACH * 2), toon('#a7d98b'));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set((LAWN_WEST + REACH) / 2, G - 0.03, 0);
  lawn.receiveShadow = true;
  group.add(lawn);
  // What you stand on anywhere out there, the lot and the road and the grass alike, and the beach.
  colliders.push({ minX: -REACH, maxX: REACH, minZ: -REACH, maxZ: REACH, bottom: G - 1, top: G });

  // The lot in front of the garage, out to the sidewalk, and the one down its east side.
  for (const [b, y] of [
    [LOT, G - 0.01],
    [SIDE_LOT, G - 0.012],
  ] as const) {
    group.add(groundPlane(b.maxX - b.minX, b.maxZ - b.minZ, (b.minX + b.maxX) / 2, y, (b.minZ + b.maxZ) / 2, null, '#9a9ea8'));
  }

  // The road, out to either end of the street, where the scenic loop takes over (world/scenic/).
  const road = roadTexture();
  road.repeat.set((STREET_END * 2) / 8, 1);
  group.add(groundPlane(STREET_END * 2, ROAD.maxZ - ROAD.minZ, 0, G - 0.008, (ROAD.minZ + ROAD.maxZ) / 2, road));
  for (const [z0, z1] of [
    [21, ROAD.minZ],
    [ROAD.maxZ, ROAD.maxZ + 2],
  ]) {
    group.add(mesh(box(STREET_END * 2 - 4, 0.08, z1 - z0), toon('#e3ddd0'), 0, G, (z0 + z1) / 2));
  }
  const forest = new THREE.Group();

  // Trees along the sidewalks and around the building.
  const trees: [number, number, number][] = [
    [-34, 22, 1.1],
    [-22, 22, 1],
    [22, 22, 1.05],
    [34, 22, 0.95],
    [-40, 32.5, 1.1],
    [-12, 32.5, 1],
    [14, 32.5, 1.15],
    [42, 32.5, 1],
    [-27, -8, 1.2],
    [-29, 4, 1],
    [-26, 14, 0.9],
    [29, -6, 1.1],
    [30, 6, 1.25],
    [-12, -22, 1.2],
    [4, -24, 1],
    // Clear of the back office, when a floor's built out into one (see WING).
    [23, -19, 1.1],
  ];
  for (const [x, z, s] of trees) {
    const t = tree(s);
    t.position.set(x, G, z);
    forest.add(t);
    // Its trunk, which you (or a car) can't go through.
    const r = 0.26 * s;
    colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, bottom: G, top: G + 2.2 * s });
  }
  group.add(mergeByMaterial(forest));

  // Street lamps down both sidewalks, their arms out over the road.
  const lamps = new THREE.Group();
  const glass = bulb(night, '#fff3d6');
  for (const x of [-40, -28, -16, -4, 8, 16, 28, 40]) streetLamp(lamps, night, glass, colliders, x, 22.2, 1);
  for (const x of [-34, -22, -4, 8, 26, 36]) streetLamp(lamps, night, glass, colliders, x, 31.8, -1);
  group.add(mergeByMaterial(lamps));

  // The neighbours: across the street, and further out behind and beside the office.
  for (const [x, z, w, h, d, color] of NEIGHBOURS) {
    if (x === 12 && z === 47) {
      buildCubeFarmBuilding(group, colliders, night);
      continue;
    }
    const b = building(w, h, d, color, night.windows);
    b.position.set(x, G, z);
    b.rotation.y = facing(x, z);
    group.add(b);
  }
  // Solid: you (and a car) stop at their walls instead of walking in.
  for (const n of neighbourBoxes()) colliders.push({ minX: n.minX, maxX: n.maxX, minZ: n.minZ, maxZ: n.maxZ, bottom: G, top: G + n.top });

  // Puffy clouds, too far off for the fog to hide.
  const cloud = night.clouds;
  cloud.fog = false;
  const puffs = new THREE.Group();
  for (const [x, y, z, s] of [
    [-70, 34, -60, 1.3],
    [-10, 40, -90, 1.6],
    [60, 36, -70, 1.2],
    [90, 30, 20, 1.4],
    [-95, 32, 30, 1.1],
    [30, 38, 95, 1.5],
    [-45, 36, 90, 1.2],
  ]) {
    const c = new THREE.Group();
    for (const [dx, dy, r] of [
      [0, 0, 5],
      [5.5, -1, 3.8],
      [-5.5, -1.2, 3.6],
      [2.5, 2.4, 3.4],
    ]) {
      const puff = mesh(new THREE.SphereGeometry(r, 14, 10), cloud, dx, dy, 0, false);
      puff.scale.y = 0.75;
      c.add(puff);
    }
    c.position.set(x, y, z);
    c.scale.setScalar(s);
    c.lookAt(0, y, 0);
    puffs.add(c);
  }
  sky.add(mergeByMaterial(puffs));
}

/** The street out front, the city along it, and the clouds over it all. */
export const street: Fixture<never, StreetSite> = (site) => {
  // The clouds stay up in the sky, however far down the street is.
  buildStreet(site.ground, site.groundColliders, site.get('night'), site.group);
  return {};
};
