import * as THREE from 'three';

const COLORS = [0x58efff, 0x2b9cff, 0xb7ff45, 0xff5fc2, 0xffe653];
const UP = new THREE.Vector3(0, 1, 0);

function material(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

export class VfxSystem {
  constructor(scene) {
    this.scene = scene;
    this.effects = [];
    this.shardGeometry = new THREE.OctahedronGeometry(0.075, 0);
    this.sparkGeometry = new THREE.TetrahedronGeometry(0.055, 0);
    this.ringGeometry = new THREE.RingGeometry(0.72, 0.86, 40);
  }

  spawnMuzzle(position, direction) {
    for (let index = 0; index < 7; index += 1) {
      const mesh = new THREE.Mesh(this.sparkGeometry, material(COLORS[index % 3], 0.9));
      mesh.position.copy(position);
      mesh.scale.setScalar(0.7 + Math.random() * 1.3);
      const velocity = direction.clone().multiplyScalar(2.5 + Math.random() * 3.5);
      velocity.x += (Math.random() - 0.5) * 2;
      velocity.y += (Math.random() - 0.5) * 2;
      velocity.z += (Math.random() - 0.5) * 2;
      this.scene.add(mesh);
      this.effects.push({ mesh, velocity, age: 0, life: 0.2 + Math.random() * 0.13, spin: 14, kind: 'particle' });
    }
    const light = new THREE.PointLight(0x61eaff, 3.8, 4, 2);
    light.position.copy(position);
    this.scene.add(light);
    this.effects.push({ mesh: light, velocity: new THREE.Vector3(), age: 0, life: 0.12, kind: 'light' });
  }

  spawnTrail(position) {
    const mesh = new THREE.Mesh(this.shardGeometry, material(COLORS[Math.floor(Math.random() * 2)], 0.62));
    mesh.position.copy(position);
    mesh.scale.setScalar(0.35 + Math.random() * 0.35);
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.3,
      0.3 + Math.random() * 0.3,
      (Math.random() - 0.5) * 0.3,
    );
    this.scene.add(mesh);
    this.effects.push({ mesh, velocity, age: 0, life: 0.28, spin: 8, kind: 'particle' });
  }

  spawnImpact(position, strong = false) {
    const count = strong ? 24 : 13;
    for (let index = 0; index < count; index += 1) {
      const color = COLORS[index % COLORS.length];
      const mesh = new THREE.Mesh(index % 2 ? this.shardGeometry : this.sparkGeometry, material(color));
      mesh.position.copy(position);
      mesh.scale.setScalar((strong ? 1.1 : 0.72) * (0.7 + Math.random()));
      const velocity = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.75 + 0.15,
        Math.random() - 0.5,
      ).normalize().multiplyScalar((strong ? 6.2 : 4.2) * (0.45 + Math.random()));
      this.scene.add(mesh);
      this.effects.push({ mesh, velocity, age: 0, life: 0.34 + Math.random() * 0.32, spin: 11, gravity: 5, kind: 'particle' });
    }
    this.spawnRing(position, strong ? 2.1 : 1.2, strong ? 0xff60c8 : 0x59eaff, false);
  }

  spawnFreezeNova(position, radius) {
    this.spawnRing(position, radius, 0x66efff, true);
    this.spawnRing(position, radius * 0.72, 0xbaff45, true, 0.08);
    for (let index = 0; index < 32; index += 1) {
      const angle = (index / 32) * Math.PI * 2;
      const mesh = new THREE.Mesh(this.shardGeometry, material(COLORS[index % 3], 0.94));
      mesh.position.copy(position).add(new THREE.Vector3(Math.cos(angle) * 0.5, 0.15, Math.sin(angle) * 0.5));
      mesh.scale.setScalar(1.1 + (index % 4) * 0.2);
      const velocity = new THREE.Vector3(Math.cos(angle), 0.25 + Math.random() * 0.3, Math.sin(angle))
        .multiplyScalar(radius * (0.9 + Math.random() * 0.25));
      this.scene.add(mesh);
      this.effects.push({ mesh, velocity, age: 0, life: 0.72, spin: 8, gravity: 2.2, kind: 'particle' });
    }
  }

  spawnRing(position, targetScale, color, horizontal = false, delay = 0) {
    const mesh = new THREE.Mesh(this.ringGeometry, material(color, 0.9));
    mesh.position.copy(position);
    mesh.position.y += horizontal ? 0.08 : 0.45;
    if (horizontal) mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(0.08);
    this.scene.add(mesh);
    this.effects.push({
      mesh,
      velocity: new THREE.Vector3(),
      age: -delay,
      life: 0.52,
      targetScale,
      kind: horizontal ? 'ground-ring' : 'billboard-ring',
    });
  }

  update(dt, camera) {
    for (let index = this.effects.length - 1; index >= 0; index -= 1) {
      const effect = this.effects[index];
      effect.age += dt;
      if (effect.age < 0) {
        effect.mesh.visible = false;
        continue;
      }
      effect.mesh.visible = true;
      const progress = Math.min(1, effect.age / effect.life);
      if (effect.kind === 'particle') {
        effect.velocity.y -= (effect.gravity || 0) * dt;
        effect.mesh.position.addScaledVector(effect.velocity, dt);
        effect.mesh.rotation.x += dt * effect.spin;
        effect.mesh.rotation.y += dt * effect.spin * 0.72;
        effect.mesh.material.opacity = (1 - progress) * 0.92;
        effect.mesh.scale.multiplyScalar(Math.max(0.7, 1 - dt * 2.5));
      } else if (effect.kind === 'light') {
        effect.mesh.intensity = 3.8 * (1 - progress);
      } else {
        const scale = THREE.MathUtils.lerp(0.08, effect.targetScale, 1 - Math.pow(1 - progress, 3));
        effect.mesh.scale.setScalar(scale);
        effect.mesh.material.opacity = Math.sin(progress * Math.PI) * 0.86;
        if (effect.kind === 'billboard-ring') effect.mesh.quaternion.copy(camera.quaternion);
      }
      if (effect.age >= effect.life) {
        this.scene.remove(effect.mesh);
        effect.mesh.material?.dispose?.();
        this.effects.splice(index, 1);
      }
    }
  }

  clear() {
    for (const effect of this.effects) {
      this.scene.remove(effect.mesh);
      effect.mesh.material?.dispose?.();
    }
    this.effects.length = 0;
  }

  dispose() {
    this.clear();
    this.shardGeometry.dispose();
    this.sparkGeometry.dispose();
    this.ringGeometry.dispose();
  }
}
