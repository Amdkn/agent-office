import type { ClientMsg, ServerMsg } from '../shared/protocol';
import { EMPTY_PLAN } from '../shared/floorplan';
import { CARS } from '../shared/garage';
import { JUKEBOX_TUNES } from '../shared/jukebox';
import { lastFloor, store, type Profile, type Spot } from './state';

type Handler = (msg: ServerMsg) => void;

/** The sign-in page, coming back to the 2D view afterwards if that's where you are (see login.ts). */
export function loginUrl(): string {
  return location.pathname === '/lite' ? '/login?next=/lite' : '/login';
}

function autonomousWelcomeMsg(): ServerMsg {
  return {
    t: 'welcome',
    you: 'user-s0-amadeuskone',
    peers: [
      {
        id: 'user-s0-amadeuskone',
        name: 'Amadou Kone (S0)',
        color: '#ff8a5b',
        look: { skin: 2, hair: 1, style: 0 },
        x: 0,
        y: -7.5,
        z: -4,
        rotY: 0,
        moving: false,
        voice: false,
        muted: true,
        sharing: false,
        floor: 'aspace-skyline',
      },
    ],
    floors: [
      {
        id: 'aspace-skyline',
        name: 'Aspace Skyline Floor',
        dir: '',
        palette: 0,
        addedBy: 'A0-Amadeus',
        addedAt: Date.now(),
        workers: 0,
        busy: 0,
        waiting: 0,
        people: 1,
        wing: 0,
      },
    ],
    projectsDir: { dir: '', custom: false },
    ice: [],
    chat: [
      {
        from: 'system',
        name: 'A0-Amadeus',
        color: '#ff8a5b',
        text: 'Aspace OS V5 · Skyline Agent-Office Autonomous Orbit Activated',
        at: Date.now(),
        account: true,
      },
    ],
    invites: false,
    version: '0.1.0-aspace-v5',
    upgrade: { available: false, phase: 'idle' },
    usage: {
      total: { input: 12000, output: 4000, cacheWrite: 0, cacheRead: 0, cost: 0.12, calls: 8 },
      today: { input: 12000, output: 4000, cacheWrite: 0, cacheRead: 0, cost: 0.12, calls: 8 },
      day: new Date().toISOString().slice(0, 10),
      pauseHiring: false,
    },
    limits: { windows: [], at: Date.now() },
    me: { admin: true, account: { name: 'Amadou Kone (S0)', role: 'admin' } },
    notify: {},
    machine: { cpu: 12, cores: 8, memUsed: 4000000000, memTotal: 16000000000, history: [], workers: 0 },
    sky: { lat: 48.8566, lon: 2.3522, utcOffset: 60, weather: 'clear', intensity: 0 },
    theme: { pick: 'auto', active: null },
    map: { pick: 'office', custom: [] },
    prompts: { custom: {} },
    leaveOnMerge: { on: false },
    floor: 'aspace-skyline',
    project: {
      name: 'Aspace OS V5 · Skyline Hub',
      dir: '',
      agentCmd: 'agy',
      defaultProvider: 'claude',
      agentProviders: ['claude', 'opencode', 'codex', 'dsh', 'pi'],
    },
    workers: [],
    issues: { items: [], fetchedAt: Date.now(), loading: false },
    pulls: { items: [], fetchedAt: Date.now(), loading: false },
    queue: { tasks: [], maxWorkers: 4 },
    decor: [],
    plan: EMPTY_PLAN,
    services: { items: [], port: 4600 },
    dog: null,
    jukebox: { on: false, track: JUKEBOX_TUNES[0].id, startedAt: Date.now(), elapsed: 0 },
    cabinet: { player: null, scores: [], frame: null },
    whiteboard: { elements: [], people: [] },
    meeting: { current: null, past: [] },
    ball: {},
    cars: CARS.map((c) => ({ x: c.x, z: c.z, rotY: c.rotY, speed: 0, steer: 0 })),
    jail: { prisoners: [], bones: 0 },
  };
}

export class Net {
  private ws: WebSocket | null = null;
  private handlers: Handler[] = [];
  private statusHandlers: ((up: boolean) => void)[] = [];
  private retry = 0;
  private closedByUs = false;
  /** The server is restarting on purpose: retry every second instead of backing off. */
  private restartExpected = false;
  up = false;

  constructor(
    private profile: () => Profile,
    /** Where you are (or were, before this page), to be put back in the same spot. */
    private where: () => Spot | null,
    /** On the 2D view: in the office without standing anywhere in it (see PeerInfo.lite). */
    private lite = false,
  ) {}

  onMessage(h: Handler) {
    this.handlers.push(h);
  }

  onStatus(h: (up: boolean) => void) {
    this.statusHandlers.push(h);
  }

  connect() {
    const { name, color, look } = this.profile();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = new URLSearchParams({ name, color, skin: String(look.skin), hair: String(look.hair), style: String(look.style) });
    // Back to the floor you were on (after a reload or a restart), in the spot you were in there.
    const floor = store.floor ?? lastFloor();
    if (floor) q.set('floor', floor);
    if (this.lite) q.set('lite', '1');
    const at = this.where();
    if (floor && at?.floor === floor) {
      for (const k of ['x', 'y', 'z'] as const) q.set(k, at[k].toFixed(2));
      q.set('rotY', at.facing.toFixed(3));
    }

    let settled = false;
    const activateAutonomous = () => {
      if (settled) return;
      settled = true;
      this.closedByUs = true;
      clearTimeout(fallbackTimer);
      try {
        if (this.ws && this.ws.readyState !== WebSocket.OPEN) this.ws.close();
      } catch {}
      this.up = true;
      this.statusHandlers.forEach((h) => h(true));
      const welcome = autonomousWelcomeMsg();
      for (const h of this.handlers) h(welcome);
    };
    const fallbackTimer = setTimeout(activateAutonomous, 600);

    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
    } catch {
      activateAutonomous();
      return;
    }

    this.ws = ws;
    ws.onerror = () => activateAutonomous();
    ws.onopen = () => {
      settled = true;
      clearTimeout(fallbackTimer);
      this.retry = 0;
      this.up = true;
      this.statusHandlers.forEach((h) => h(true));
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = async () => {
      if (this.ws !== ws) return;
      this.up = false;
      this.statusHandlers.forEach((h) => h(false));
      if (this.closedByUs) return;
      // Session expired? Go back to the door.
      try {
        const res = await fetch('/api/whoami', { cache: 'no-store' });
        if (res.status === 401) {
          location.href = loginUrl();
          return;
        }
      } catch {
        // offline; keep retrying
      }
      const delay = this.restartExpected ? 1000 : Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  expectRestart() {
    this.restartExpected = true;
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return;
    }
    // Autonomous local simulation when offline / serverless so cars are 100% drivable on Scenic Loop
    if (msg.t === 'car.enter') {
      const c = store.cars[msg.car];
      if (c && !c.driver) {
        c.driver = store.you;
        const nextCars = store.cars.map((car) => ({ ...car }));
        for (const h of this.handlers) h({ t: 'cars', cars: nextCars });
      }
    } else if (msg.t === 'car.leave') {
      const idx = store.cars.findIndex((c) => c.driver === store.you);
      if (idx >= 0) {
        const c = store.cars[idx];
        delete c.driver;
        c.speed = 0;
        c.steer = 0;
        const nextCars = store.cars.map((car) => ({ ...car }));
        for (const h of this.handlers) h({ t: 'cars', cars: nextCars });
      }
    } else if (msg.t === 'car.drive') {
      const idx = store.cars.findIndex((c) => c.driver === store.you);
      if (idx >= 0) {
        const c = store.cars[idx];
        c.x = msg.x;
        c.z = msg.z;
        c.rotY = msg.rotY;
        c.speed = msg.speed;
        c.steer = msg.steer;
      }
    }
  }
}
