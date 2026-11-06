import type { ClientMsg, ServerMsg } from '../shared/protocol';
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
    peers: [],
    floors: [{ id: 'aspace-skyline', name: 'Aspace Skyline Floor', floor: 1, path: '' }],
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
    me: { admin: true, account: { name: 'Amadou Kone (S0)', email: 'amado@aspaceos.tech' } },
    notify: {},
    machine: { cpu: 12, cores: 8, memUsed: 4000000000, memTotal: 16000000000, history: [], workers: 0 },
    sky: { lat: 48.8566, lon: 2.3522, utcOffset: 60, weather: 'clear', intensity: 0 },
    theme: { pick: 'auto', active: null },
    map: { pick: 'office', custom: [] },
    prompts: { custom: {} },
    leaveOnMerge: false,
    floor: 'aspace-skyline',
    project: { id: 'aspace-os-v5', name: 'Aspace OS V5 · Skyline Hub', path: '' },
    workers: [],
    issues: { items: [], fetchedAt: Date.now(), loading: false },
    pulls: { items: [], fetchedAt: Date.now(), loading: false },
    queue: { tasks: [], maxWorkers: 4 },
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
    const fallbackTimer = setTimeout(() => {
      if (!settled && !this.up) {
        settled = true;
        try {
          if (this.ws && this.ws.readyState !== WebSocket.OPEN) this.ws.close();
        } catch {}
        this.up = true;
        this.statusHandlers.forEach((h) => h(true));
        const welcome = autonomousWelcomeMsg();
        for (const h of this.handlers) h(welcome);
      }
    }, 1200);

    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
    } catch {
      settled = true;
      clearTimeout(fallbackTimer);
      this.up = true;
      this.statusHandlers.forEach((h) => h(true));
      const welcome = autonomousWelcomeMsg();
      for (const h of this.handlers) h(welcome);
      return;
    }

    this.ws = ws;
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
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
