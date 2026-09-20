// objects.js — the things in the world, loaded from files.
//
// Adam, after driving it: "NOTHING IS CREATED WITH MATH, ITS ASSETS AND FILES
// OK??" — and "EVERYTHING, EVERYTHING, GETS PHYSICS".
//
// So this is the layer that makes both true. Every object in the world is a
// model file from data/kit (Kenney's Racing Kit, CC0) standing at a position
// written down in data/build/objects.js. Nothing here derives a position from
// the track: a wall in the wrong place is a line in a file that can be edited
// or deleted, not a formula that has to be re-derived and re-argued about.
//
// And every object that is `solid` registers a wall with the physics world, so
// hitting it is a contact with a lever arm and an impulse, not a decoration
// you drive through. js/props.js owns that; this file only tells it where the
// walls are.
//
// The kit is in ITS units, not metres. One unit is 3.09 m, measured off
// raceCarRed against a 4.6 m car (tools/kitinfo.mjs reads the bounds straight
// out of the .glb, so nobody has to eyeball it).
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/addons/loaders/GLTFLoader.js';
import { V } from './meshes.js';
import { UNIT, OBJECTS, SOLID } from '../../data/build/objects.js';

const KIT = './data/kit/';

export class Objects {
  /**
   * `groundY(x, y)` is how high the land is at a point, in the SIM frame. A
   * function rather than a Ground, because the builder gets it from
   * js/build/ground.js and the game gets it from js/world.js and neither
   * should have to know about the other.
   */
  constructor(scene, groundY, props) {
    this.scene = scene;
    this.groundY = groundY;
    this.props = props;
    this.group = new THREE.Group();
    this.group.name = 'objects';
    scene.add(this.group);
    this.counts = { placed: 0, models: 0, walls: 0, missing: [] };
  }

  async build() {
    if (!OBJECTS.length) return this;
    const loader = new GLTFLoader();
    // One load per MODEL, however many times it is placed. A hundred walls is
    // one file read and one instanced draw.
    const byModel = new Map();
    for (const o of OBJECTS) {
      if (!byModel.has(o.model)) byModel.set(o.model, []);
      byModel.get(o.model).push(o);
    }

    await Promise.all([...byModel.entries()].map(async ([name, list]) => {
      let gltf;
      try {
        gltf = await loader.loadAsync(`${KIT}${name}.glb`);
      } catch {
        this.counts.missing.push(name);
        return;
      }
      // Kenney's models are a scene of meshes; merge-by-material is overkill
      // here, so each mesh in the model becomes one InstancedMesh.
      const parts = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone();
        geo.applyMatrix4(o.matrixWorld);
        parts.push({ geo, mat: o.material });
      });
      if (!parts.length) { this.counts.missing.push(name); return; }
      this.counts.models++;

      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      const pos = new THREE.Vector3(), scl = new THREE.Vector3();
      const inst = parts.map(({ geo, mat }) => {
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        im.castShadow = true; im.receiveShadow = true;
        this.group.add(im);
        return im;
      });
      list.forEach((o, i) => {
        const [x, y] = o.at;
        // Height: whatever is written down, else stand it on the ground.
        const h = o.z ?? (this.groundY ? this.groundY(x, y) : 0);
        const s = (o.scale ?? 1) * UNIT;
        q.setFromAxisAngle(up, (o.ry ?? 0) * Math.PI / 180);
        pos.copy(V(x, y, h));
        scl.set(s, (o.scaleY ?? o.scale ?? 1) * UNIT, s);
        m.compose(pos, q, scl);
        for (const im of inst) im.setMatrixAt(i, m);
        this.counts.placed++;
      });
      for (const im of inst) im.instanceMatrix.needsUpdate = true;
    }));

    this.solidify();
    return this;
  }

  // Every solid object hands the physics world a segment to collide with.
  // SOLID says how long a model is along its own x, in kit units, and how
  // tall — read off the files by tools/kitinfo.mjs, not guessed.
  solidify() {
    if (!this.props) return;
    for (const o of OBJECTS) {
      const spec = SOLID[o.model];
      if (!spec) continue;
      const [x, y] = o.at;
      const half = (spec.len * 0.5) * (o.scale ?? 1) * UNIT;
      const a = ((o.ry ?? 0) + (spec.along ?? 0)) * Math.PI / 180;
      const dx = Math.cos(a) * half, dy = Math.sin(a) * half;
      this.props.addWall(x - dx, y - dy, x + dx, y + dy, {
        height: spec.tall * (o.scale ?? 1) * UNIT,
        bounce: spec.bounce ?? 0.25,
        id: o.model,
      });
      this.counts.walls++;
    }
  }

  stats() {
    return { ...this.counts, missing: this.counts.missing.slice(0, 4) };
  }
}
