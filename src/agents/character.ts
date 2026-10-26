import * as THREE from 'three';
import { mat } from '../core/palette';
import { ball, box, cyl, rbox } from '../world/kit';

export interface AgentLook {
  shirt: number;
  pants: number;
  skin: number;
  hair: number;
}

export interface CharacterRig {
  group: THREE.Group;
  body: THREE.Group;
  upper: THREE.Group;
  head: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  shinL: THREE.Group;
  shinR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  mug: THREE.Group;
  gamepad: THREE.Group;
  hipHeight: number;
}

const HIP = 0.86;

function limb(material: THREE.Material, width: number, height: number, depth: number): THREE.Mesh {
  return rbox(width, height, depth, 0.05, material, 0, -height / 2, 0);
}

function buildLeg(pants: THREE.Material, shoe: THREE.Material, x: number) {
  const hip = new THREE.Group();
  hip.position.set(x, HIP, 0);
  hip.add(limb(pants, 0.2, 0.4, 0.24));

  const knee = new THREE.Group();
  knee.position.y = -0.4;
  hip.add(knee);
  knee.add(rbox(0.18, 0.38, 0.21, 0.05, pants, 0, -0.19, 0));
  knee.add(box(0.21, 0.1, 0.32, shoe, 0, -0.41, 0.06));
  return { hip, knee };
}

function buildArm(shirt: THREE.Material, skin: THREE.Material, x: number): THREE.Group {
  const shoulder = new THREE.Group();
  shoulder.position.set(x, 0.56, 0);
  shoulder.add(limb(shirt, 0.16, 0.44, 0.18));
  shoulder.add(ball(0.085, skin, 0, -0.5, 0, 10));
  return shoulder;
}

function buildMug(): THREE.Group {
  const mug = new THREE.Group();
  mug.add(cyl(0.055, 0.05, 0.11, mat(0xf6f1e7), 0, 0.055, 0, 12));
  mug.add(cyl(0.045, 0.045, 0.01, mat(0x6f4a32), 0, 0.112, 0, 12));
  mug.add(box(0.03, 0.07, 0.02, mat(0xf6f1e7), 0.062, 0.06, 0));
  return mug;
}

function buildGamepad(): THREE.Group {
  const pad = new THREE.Group();
  pad.add(rbox(0.26, 0.06, 0.13, 0.03, mat(0x2c3238), 0, 0, 0));
  pad.add(ball(0.022, mat(0xe07a5f), -0.07, 0.035, 0, 8));
  pad.add(ball(0.022, mat(0xe2b44a), -0.03, 0.035, 0, 8));
  pad.add(ball(0.02, mat(0x8fae9b), 0.07, 0.035, 0, 8));
  return pad;
}

export function createCharacter(look: AgentLook): CharacterRig {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const pants = mat(look.pants, { roughness: 0.95 });
  const shirt = mat(look.shirt, { roughness: 0.9 });
  const skin = mat(look.skin, { roughness: 0.8 });
  const hair = mat(look.hair, { roughness: 0.95 });
  const shoe = mat(0x2f3438, { roughness: 0.9 });

  const left = buildLeg(pants, shoe, -0.17);
  const right = buildLeg(pants, shoe, 0.17);
  body.add(left.hip, right.hip);

  const upper = new THREE.Group();
  upper.position.y = HIP;
  body.add(upper);

  upper.add(rbox(0.44, 0.2, 0.3, 0.06, pants, 0, 0.08, 0));
  upper.add(rbox(0.56, 0.62, 0.34, 0.09, shirt, 0, 0.38, 0));
  upper.add(box(0.36, 0.07, 0.32, mat(0xf1e7d6), 0, 0.685, 0));

  const head = new THREE.Group();
  head.position.y = 0.7;
  upper.add(head);
  head.add(cyl(0.07, 0.075, 0.08, skin, 0, 0.02, 0, 12));
  head.add(rbox(0.32, 0.32, 0.3, 0.08, skin, 0, 0.22, 0));
  head.add(box(0.345, 0.1, 0.32, hair, 0, 0.38, 0));
  head.add(box(0.34, 0.18, 0.1, hair, 0, 0.27, -0.11));
  head.add(box(0.042, 0.05, 0.02, mat(0x241f1c), -0.075, 0.22, 0.152));
  head.add(box(0.042, 0.05, 0.02, mat(0x241f1c), 0.075, 0.22, 0.152));

  const armL = buildArm(shirt, skin, -0.37);
  const armR = buildArm(shirt, skin, 0.37);
  upper.add(armL, armR);

  const mug = buildMug();
  mug.position.set(0, -0.55, 0.08);
  mug.visible = false;
  armR.add(mug);

  const gamepad = buildGamepad();
  gamepad.position.set(0, 1.04, 0.36);
  gamepad.visible = false;
  body.add(gamepad);

  return {
    group,
    body,
    upper,
    head,
    legL: left.hip,
    legR: right.hip,
    shinL: left.knee,
    shinR: right.knee,
    armL,
    armR,
    mug,
    gamepad,
    hipHeight: HIP,
  };
}
