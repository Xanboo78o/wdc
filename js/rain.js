// rain.js — rain you can see: streaks falling through a box that travels with
// the camera, stretched along the motion so at speed it rakes past sideways
// the way it does on an onboard. One draw call; the count follows intensity.
import * as THREE from 'three';

const N = 6000, BOX = [70, 34, 70];

export class Rain {
  constructor(scene) {
    this.pos = new Float32Array(N * 6);
    this.drop = new Float32Array(N * 3);          // each drop's home in the box
    for (let i = 0; i < N; i++) {
      this.drop[i * 3] = (Math.random() - 0.5) * BOX[0];
      this.drop[i * 3 + 1] = Math.random() * BOX[1];
      this.drop[i * 3 + 2] = (Math.random() - 0.5) * BOX[2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.mat = new THREE.LineBasicMaterial({ color: 0xc8d4e2, transparent: true, opacity: 0.35, depthWrite: false });
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.geo = g;
    this.fall = 0;
    this.prev = null;
  }

  /** `rain` mm/h, `cam` the camera, `dt` s. */
  update(rain, cam, dt) {
    const k = Math.min(1, rain / 6);
    const n = Math.floor(N * Math.min(1, k * 1.4));
    this.mesh.visible = n > 0;
    if (!n) return;
    const c = cam.position;
    // camera velocity, for the streak direction
    let vx = 0, vy = 0, vz = 0;
    if (this.prev && dt > 0) { vx = (c.x - this.prev.x) / dt; vy = (c.y - this.prev.y) / dt; vz = (c.z - this.prev.z) / dt; }
    this.prev = c.clone();
    this.fall += dt * 9.0;
    const P = this.pos, D = this.drop;
    const len = 0.045;                             // seconds of motion in a streak
    for (let i = 0; i < n; i++) {
      // wrap each drop into the box around the camera
      const wx = ((D[i * 3] - c.x) % BOX[0] + BOX[0] * 1.5) % BOX[0] - BOX[0] / 2 + c.x;
      const wz = ((D[i * 3 + 2] - c.z) % BOX[2] + BOX[2] * 1.5) % BOX[2] - BOX[2] / 2 + c.z;
      const wy = c.y - 8 + ((D[i * 3 + 1] - this.fall) % BOX[1] + BOX[1]) % BOX[1];
      const o = i * 6;
      P[o] = wx; P[o + 1] = wy; P[o + 2] = wz;
      // the tail: where the drop was relative to a moving eye
      P[o + 3] = wx + vx * len; P[o + 4] = wy + (9.0 + vy) * len; P[o + 5] = wz + vz * len;
    }
    this.geo.setDrawRange(0, n * 2);
    this.geo.attributes.position.needsUpdate = true;
    this.mat.opacity = 0.18 + 0.3 * k;
  }
}
