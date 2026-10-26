import './style.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { installApi } from './api';
import { ACTIVITY_LABEL } from './agents/activities';
import { Agent } from './agents/agent';
import { Autopilot } from './agents/autopilot';
import { AGENT_SEEDS, STARTING_STATE } from './agents/seeds';
import { DayCycle } from './core/dayNight';
import { buildNavGraph, OFFICE_DEPTH, OFFICE_WIDTH, spot } from './world/layout';
import { OfficeWorld } from './world/office';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const fatal = document.getElementById('fatal');

function fail(message: string): void {
  if (!fatal) return;
  fatal.hidden = false;
  fatal.textContent = message;
}

if (!canvas) {
  fail('Canvas #scene tidak ditemukan.');
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
  const agents = STARTING_STATE.map((entry) => {
    const seed = AGENT_SEEDS[entry.seedIndex];
    return new Agent(seed, nav, spot(entry.spot), entry.holdFor);
  });

  for (const agent of agents) {
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
  }

  const autopilot = new Autopilot(agents);
  const clock = new DayCycle(8.1, 0.11);

  // ------------------------------------------------------------------ hud ---

  const timeEl = document.getElementById('time');
  const phaseEl = document.getElementById('phase');
  const progressEl = document.getElementById('progress');
  const countEl = document.getElementById('agent-count');
  const legendEl = document.getElementById('legend');
  const stateEls = new Map<string, HTMLElement>();

  if (countEl) countEl.textContent = String(agents.length);
  if (legendEl) {
    for (const agent of agents) {
      const row = document.createElement('li');
      row.className = 'legend__row';

      const dot = document.createElement('span');
      dot.className = 'legend__dot';
      dot.style.background = agent.color;

      const name = document.createElement('span');
      name.className = 'legend__name';
      name.textContent = agent.name;

      const state = document.createElement('span');
      state.className = 'legend__state';
      state.textContent = '—';

      row.append(dot, name, state);
      legendEl.append(row);
      stateEls.set(agent.id, state);
    }
  }

  function updateHUD(): void {
    if (timeEl) timeEl.textContent = clock.timeLabel;
    if (phaseEl) phaseEl.textContent = clock.phaseLabel;
    if (progressEl) progressEl.style.width = `${(clock.progress * 100).toFixed(1)}%`;

    for (const agent of agents) {
      const el = stateEls.get(agent.id);
      if (!el) continue;
      const label = ACTIVITY_LABEL[agent.spot.activity];
      el.textContent = agent.mode === 'walking' ? `→ ${label}` : label;
      el.dataset.state = agent.mode;
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
  installApi(agents, clock);

  window.addEventListener('error', (event) => {
    fail(`Render error: ${event.message}`);
  });
}
