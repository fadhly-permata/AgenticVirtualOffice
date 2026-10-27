import './style.css';
import './ui.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyStatic, followBrowserLocale, t } from './i18n';
import { initTheme } from './theme';
import { installApi } from './api';
import type { CrewFactory } from './api';
import { installChat } from './chat/chat';
import { ACTIVITY_LABEL } from './agents/activities';
import { Agent } from './agents/agent';
import { Autopilot } from './agents/autopilot';
import { AGENT_SEEDS, MAX_AGENTS, parseAgentCount, startingState } from './agents/seeds';
import type { CrewEntry } from './office/presence';
import { DayCycle } from './core/dayNight';
import { buildNavGraph, OFFICE_DEPTH, OFFICE_WIDTH, ROOM_NODES, spot } from './world/layout';
import { OfficeWorld } from './world/office';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const fatal = document.getElementById('fatal');

initTheme();
followBrowserLocale();
applyStatic();

function fail(message: string): void {
  if (!fatal) return;
  fatal.hidden = false;
  fatal.textContent = message;
}

if (!canvas) {
  fail(t('shell.canvasMissing'));
} else {
  try {
    boot(canvas);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function boot(target: HTMLCanvasElement): void {
  const renderer = new THREE.WebGLRenderer({
    canvas: target,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();

  // Image-based lighting. Without an environment, metals and glass have
  // nothing to reflect and read as flat, dark fills.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;
  pmrem.dispose();

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 260);
  const focus = new THREE.Vector3(OFFICE_WIDTH / 2, 1.5, OFFICE_DEPTH / 2);
  camera.position.set(focus.x + 54, focus.y + 54, focus.z + 54);
  camera.lookAt(focus);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(focus.x, focus.y, focus.z);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.minPolarAngle = Math.PI / 3.5;
  controls.maxAzimuthAngle = Math.PI;
  controls.minAzimuthAngle = 0;
  controls.update();

  const world = new OfficeWorld();
  scene.add(world.root);

  const nav = buildNavGraph();
  const agents: Agent[] = [];
  const plan = startingState(MAX_AGENTS);
  const requestedAgents = parseAgentCount(new URLSearchParams(window.location.search).get('agents'));
  let legendDirty = true;
  let legendBusyIds = '';

  const crew: CrewFactory = {
    add(entry, index) {
      const seatPlan = plan[index];
      const seed = AGENT_SEEDS[seatPlan?.seedIndex ?? 0];
      if (!seatPlan || !seed) return null;

      const agent = new Agent(
        { id: entry.id, name: entry.label, color: seed.color, look: seed.look },
        nav,
        spot(seatPlan.spot),
        seatPlan.holdFor
      );
      agent.onSettled = (settled) => {
        document.dispatchEvent(
          new CustomEvent('virtoffice:agent', {
            detail: {
              id: settled.id,
              name: settled.name,
              activity: settled.activity,
              spot: settled.spot.id,
              room: settled.spot.room,
            },
          })
        );
      };
      world.root.add(agent.group);
      legendDirty = true;
      return agent;
    },

    remove(agent) {
      agent.group.removeFromParent();
      agent.group.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry.dispose();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) material?.dispose();
      });
      legendDirty = true;
    },
  };

  const autopilot = new Autopilot(agents);
  const clock = new DayCycle(8.1, 0.11);
  const office = installApi(agents, clock, autopilot, crew);

  // ------------------------------------------------------------------ hud ---

  const timeEl = document.getElementById('time');
  const phaseEl = document.getElementById('phase');
  const progressEl = document.getElementById('progress');
  const countEl = document.getElementById('agent-count');
  const floorModeEl = document.getElementById('floor-mode');
  const legendEl = document.getElementById('legend');
  const stateEls = new Map<string, HTMLElement>();
  const legendRankById = new Map<string, number>();

  /** Meeting table first, then the desks, then whoever is free — the busiest rows stay on top. */
  function legendRank(agent: Agent): number {
    // Sinyal = sesi nyata yang memegang orang ini, bahkan kalau semua kursi penuh.
    if (!agent.pinned && !agent.signal) return 2;
    return agent.activity === 'meeting' ? 0 : 1;
  }

  function renderLegend(): void {
    if (countEl) countEl.textContent = String(agents.length);
    if (!legendEl) return;

    // Susunan baru memindahkan baris, jadi posisi scroll hanya dipertahankan
    // selama tidak ada sesi yang mengambil atau melepas kursi.
    const keptTop = legendEl.scrollTop;
    const busyIds = agents
      .filter((agent) => agent.pinned || agent.signal)
      .map((agent) => agent.id)
      .join(',');

    legendEl.replaceChildren();
    stateEls.clear();
    legendRankById.clear();

    for (const agent of [...agents].sort((a, b) => legendRank(a) - legendRank(b))) {
      const rank = legendRank(agent);
      legendRankById.set(agent.id, rank);

      const row = document.createElement('li');
      row.className = 'legend__row';
      row.dataset.rank = String(rank);

      const dot = document.createElement('span');
      dot.className = 'legend__dot';
      dot.style.background = agent.color;

      const name = document.createElement('span');
      name.className = 'legend__name';
      name.textContent = agent.name;
      name.title = agent.name;

      const state = document.createElement('span');
      state.className = 'legend__state';
      state.textContent = '—';

      row.append(dot, name, state);
      legendEl.append(row);
      stateEls.set(agent.id, state);
    }

    legendEl.scrollTop = busyIds === legendBusyIds ? keptTop : 0;
    legendBusyIds = busyIds;
  }

  // Without a workspace to read agents from, the floor keeps its demo staff.
  const demoCrew: CrewEntry[] = AGENT_SEEDS.slice(0, requestedAgents).map((seed) => ({
    id: seed.id,
    label: seed.name,
  }));
  office.setCrew(demoCrew);
  renderLegend();
  legendDirty = false;

  function updateHUD(): void {
    if (timeEl) timeEl.textContent = clock.timeLabel;
    if (phaseEl) phaseEl.textContent = clock.phaseLabel;
    if (progressEl) progressEl.style.width = `${(clock.progress * 100).toFixed(1)}%`;
    // Lantai 'live' berarti bangku kerja hanya diisi sesi OpenCode yang benar-benar jalan.
    if (floorModeEl) {
      floorModeEl.textContent =
        autopilot.floorMode === 'live' ? t('shell.floorLive') : t('shell.floorAutoPlay');
      floorModeEl.dataset.mode = autopilot.floorMode;
    }
    // Orang pindah kursi = barisnya harus disusun ulang, bukan cuma labelnya diganti.
    if (agents.some((agent) => legendRankById.get(agent.id) !== legendRank(agent))) legendDirty = true;
    if (legendDirty) {
      renderLegend();
      legendDirty = false;
    }

    for (const agent of agents) {
      const el = stateEls.get(agent.id);
      if (!el) continue;
      const label = ACTIVITY_LABEL[agent.spot.activity];
      el.textContent = agent.mode === 'walking' ? `→ ${label}` : label;
      el.dataset.state = agent.mode;
      // 'real' = kursi dipegang sesi OpenCode yang jalan, bukan jatah autopilot.
      el.dataset.live = agent.pinned || agent.signal ? 'real' : 'auto';
    }
  }

  const root = document.documentElement;
  let skyTop = '';
  let skyBottom = '';
  let skyGlow = '';

  function updateSky(): void {
    const sky = clock.sky();
    if (sky.top !== skyTop) {
      root.style.setProperty('--sky-top', sky.top);
      skyTop = sky.top;
    }
    if (sky.bottom !== skyBottom) {
      root.style.setProperty('--sky-bottom', sky.bottom);
      skyBottom = sky.bottom;
    }
    if (sky.glow !== skyGlow) {
      root.style.setProperty('--sky-glow', sky.glow);
      skyGlow = sky.glow;
    }
  }

  // --------------------------------------------------------------- resize ---

  const VIEW_HEIGHT = 29;
  const MIN_WIDTH = 39;

  function resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / Math.max(1, height);
    const viewHeight = Math.max(VIEW_HEIGHT, MIN_WIDTH / aspect);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);

    camera.left = (-viewHeight * aspect) / 2;
    camera.right = (viewHeight * aspect) / 2;
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    camera.updateProjectionMatrix();

    // Keep controls target glued to the office focus when resizing
    controls.target.set(focus.x, focus.y, focus.z);
    controls.update();
  }

  window.addEventListener('resize', resize);
  resize();

  // ----------------------------------------------------------------- loop ---

  const workRoomNodes = new Set<string>([
    ...(ROOM_NODES.get('workspace') ?? []),
    ...(ROOM_NODES.get('meeting') ?? []),
  ]);

  /**
   * Kerjaan asli yang menentukan siapa boleh duduk di mana: di lantai live hanya
   * sesi yang jalan yang boleh masuk ruang kerja atau ruang meeting, dan di demo
   * ruang meeting tetap tertutup selama ada yang duduk di dalamnya.
   */
  function blockedRooms(): ReadonlySet<string> | null {
    if (autopilot.floorMode === 'live') return workRoomNodes;
    const meetingInUse = agents.some(
      (agent) => agent.mode === 'settled' && agent.spot.activity === 'meeting',
    );
    return meetingInUse ? (ROOM_NODES.get('meeting') ?? null) : null;
  }

  let last = performance.now();
  let elapsed = 0;
  let hudTick = 0;
  let started = false;

  function frame(now: number): void {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    elapsed += dt;

    controls.update(); // keep orbit controls in sync

    clock.update(dt);
    nav.blockNodes(blockedRooms());
    autopilot.update(elapsed, clock.nightFactor);
    for (const agent of agents) agent.update(dt, elapsed);

    const working = new Set<string>();
    let gaming = false;
    for (const agent of agents) {
      if (agent.mode !== 'settled') continue;
      if (agent.spot.activity === 'working') working.add(agent.spot.id);
      if (agent.spot.activity === 'gaming') gaming = true;
    }

    world.update(dt, working, gaming);
    world.applyDay(clock);
    scene.environmentIntensity = 0.05 + 0.27 * clock.dayFactor;
    updateSky();

    hudTick += dt;
    if (hudTick >= 0.15) {
      updateHUD();
      hudTick = 0;
    }

    renderer.render(scene, camera);

    if (!started) {
      started = true;
      updateHUD();
      document.body.classList.add('is-ready');
      document.documentElement.dataset.virtoffice = 'ready';
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  installChat(office);

  window.addEventListener('error', (event) => {
    fail(t('shell.renderError', { message: event.message }));
  });
}
