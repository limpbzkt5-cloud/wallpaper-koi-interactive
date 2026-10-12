import * as THREE from "three";
import {
  LOTUS,
  LOTUS_FLOWERS,
  LOTUS_LEAVES,
  viewportPoint,
} from "./config";

interface Point {
  x: number;
  y: number;
}

interface LeafPalette {
  base: THREE.Color;
  light: THREE.Color;
  shade: THREE.Color;
  vein: THREE.Color;
  center: THREE.Color;
}

interface FlowerPalette {
  outerPetal: THREE.Color;
  innerPetal: THREE.Color;
  petalLight: THREE.Color;
  center: THREE.Color;
  centerDark: THREE.Color;
}

const TAU = Math.PI * 2;

const PALETTES: readonly LeafPalette[] = LOTUS.leafPalettes.map((palette) => ({
  base: new THREE.Color(palette.base),
  light: new THREE.Color(palette.light),
  shade: new THREE.Color(palette.shade),
  vein: new THREE.Color(palette.vein),
  center: new THREE.Color(palette.center),
}));

const FLOWER_PALETTES: readonly FlowerPalette[] = LOTUS.flowerPalettes.map(
  (palette) => ({
    outerPetal: new THREE.Color(palette.outerPetal),
    innerPetal: new THREE.Color(palette.innerPetal),
    petalLight: new THREE.Color(palette.petalLight),
    center: new THREE.Color(palette.center),
    centerDark: new THREE.Color(palette.centerDark),
  }),
);

// Collects static, local-space geometry. Built once per refreshConfig; only
// object transforms change per frame.
class LotusGeometryBuilder {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];

  public get vertexCount(): number {
    return this.positions.length / 3;
  }

  public point(point: Point, color: THREE.Color): void {
    this.positions.push(point.x, point.y, 0);
    this.colors.push(color.r, color.g, color.b);
  }

  public triangle(
    a: Point,
    b: Point,
    c: Point,
    color: THREE.Color,
  ): void {
    this.point(a, color);
    this.point(b, color);
    this.point(c, color);
  }

  public triangleColors(
    a: Point,
    b: Point,
    c: Point,
    colorA: THREE.Color,
    colorB: THREE.Color,
    colorC: THREE.Color,
  ): void {
    this.point(a, colorA);
    this.point(b, colorB);
    this.point(c, colorC);
  }

  public line(a: Point, b: Point, color: THREE.Color): void {
    this.point(a, color);
    this.point(b, color);
  }

  public circle(center: Point, radius: number, color: THREE.Color): void {
    for (let index = 0; index < 8; index += 1) {
      const angleA = (index / 8) * TAU;
      const angleB = ((index + 1) / 8) * TAU;
      this.triangle(
        center,
        {
          x: center.x + Math.cos(angleA) * radius,
          y: center.y + Math.sin(angleA) * radius,
        },
        {
          x: center.x + Math.cos(angleB) * radius,
          y: center.y + Math.sin(angleB) * radius,
        },
        color,
      );
    }
  }

  public toGeometry(name: string): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(this.positions), 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(this.colors), 3),
    );
    geometry.name = name;
    return geometry;
  }
}

interface LotusLeafMesh {
  group: THREE.Group;
  shadowMesh: THREE.Mesh;
  geometries: THREE.BufferGeometry[];
}

interface LotusFlowerMesh {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
}

interface LeafDynamicState {
  bob: number;
  bobVel: number;
  tilt: number;
  tiltVel: number;
  pushX: number;
  pushY: number;
  pushVelX: number;
  pushVelY: number;
}

export class LotusLeavesPass {
  public readonly shadowGroup = new THREE.Group();
  public readonly group = new THREE.Group();

  private readonly leafCenterColor = new THREE.Color();
  private readonly leafEdgeColorA = new THREE.Color();
  private readonly leafEdgeColorB = new THREE.Color();
  private readonly shadowMaterial = new THREE.MeshBasicMaterial({
    color: LOTUS.shadow.color,
    opacity: LOTUS.shadow.opacity,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly leafMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly veinMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly flowerMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private leaves: LotusLeafMesh[] = [];
  private flowers: LotusFlowerMesh[] = [];
  // Per-frame scratch: animated center of each built leaf.
  private leafCenters: Point[] = [];
  private readonly leafDynamics: LeafDynamicState[] = [];
  private lastUpdateTime = -1;

  public constructor() {
    this.refreshConfig();
  }

  public refreshConfig(): void {
    this.shadowMaterial.color.setHex(LOTUS.shadow.color);
    this.shadowMaterial.opacity = LOTUS.shadow.opacity;
    for (const [index, palette] of LOTUS.leafPalettes.entries()) {
      const target = PALETTES[index];
      if (!target) continue;
      target.base.setHex(palette.base);
      target.light.setHex(palette.light);
      target.shade.setHex(palette.shade);
      target.vein.setHex(palette.vein);
      target.center.setHex(palette.center);
    }
    for (const [index, palette] of LOTUS.flowerPalettes.entries()) {
      const target = FLOWER_PALETTES[index];
      if (!target) continue;
      target.outerPetal.setHex(palette.outerPetal);
      target.innerPetal.setHex(palette.innerPetal);
      target.petalLight.setHex(palette.petalLight);
      target.center.setHex(palette.center);
      target.centerDark.setHex(palette.centerDark);
    }
    this.rebuild();
  }

  public update(time: number, ripples?: any): void {
    if (
      LOTUS_LEAVES.length !== this.leaves.length ||
      LOTUS_FLOWERS.length !== this.flowers.length
    ) {
      this.rebuild();
    }

    const dt = this.lastUpdateTime >= 0
      ? Math.min(0.05, Math.max(0.001, time - this.lastUpdateTime))
      : 0.016;
    this.lastUpdateTime = time;

    const visibleLeafCount = LOTUS.visibleLeafCount;
    const visibleFlowerCount = LOTUS.visibleFlowerCount;
    const shadowOffset = LOTUS.shadow.offset;

    // Damped harmonic oscillator constants
    const kBob = 52.0;
    const cBob = 5.8;
    const kTilt = 60.0;
    const cTilt = 7.0;
    const kPush = 28.0;
    const cPush = 6.2;

    const rippleInstances = ripples
      ? ("instances" in ripples ? ripples.instances : ripples)
      : null;

    for (const [leafIndex, mesh] of this.leaves.entries()) {
      const visible = leafIndex < visibleLeafCount;
      mesh.group.visible = visible;
      mesh.shadowMesh.visible = visible;
      if (!visible) continue;

      const leaf = LOTUS_LEAVES[leafIndex];
      const dyn = this.leafDynamics[leafIndex] ?? {
        bob: 0,
        bobVel: 0,
        tilt: 0,
        tiltVel: 0,
        pushX: 0,
        pushY: 0,
        pushVelX: 0,
        pushVelY: 0,
      };

      let bobAcc = -kBob * dyn.bob - cBob * dyn.bobVel;
      let tiltAcc = -kTilt * dyn.tilt - cTilt * dyn.tiltVel;
      let pushAccX = -kPush * dyn.pushX - cPush * dyn.pushVelX;
      let pushAccY = -kPush * dyn.pushY - cPush * dyn.pushVelY;

      const placement = viewportPoint(leaf.x, leaf.y);
      const leafRadius = leaf.radius * LOTUS.radiusScale;
      const currentCenterX = placement.x + dyn.pushX;
      const currentCenterY = placement.y + dyn.pushY;

      if (rippleInstances && Array.isArray(rippleInstances)) {
        for (let i = 0; i < rippleInstances.length; i++) {
          const rip = rippleInstances[i];
          if (!rip || !rip.alive || rip.age < 0) continue;

          // Compute ripple wavefront propagation
          const startRadius = rip.type === "touch" ? 4 : rip.type === "mouth" ? 1.2 : 0.8;
          const expansionSpeed = rip.type === "touch" ? 62 : rip.type === "mouth" ? 17 : 30;
          const lifetime = rip.type === "touch" ? 2.2 : rip.type === "mouth" ? 0.9 : 1.25;

          const waveRadius = startRadius + expansionSpeed * rip.age;
          const dx = currentCenterX - rip.center.x;
          const dy = currentCenterY - rip.center.y;
          const dist = Math.hypot(dx, dy);

          const waveBand = 26.0;
          const distToWavefront = Math.abs(dist - waveRadius);

          if (distToWavefront < leafRadius + waveBand && rip.age < lifetime) {
            const waveProximity = Math.exp(-Math.pow(distToWavefront / waveBand, 2));
            const lifeRemaining = Math.max(0, 1 - rip.age / lifetime);
            const typeWeight = rip.type === "touch" ? 1.6 : rip.type === "mouth" ? 0.8 : 0.4;
            const waveForce = rip.strength * waveProximity * lifeRemaining * typeWeight;

            if (waveForce > 0.008) {
              bobAcc += waveForce * 125.0;

              const safeDist = Math.max(dist, 1.0);
              const nx = dx / safeDist;
              const ny = dy / safeDist;

              pushAccX += nx * waveForce * 28.0;
              pushAccY += ny * waveForce * 28.0;

              const torque = (nx * 0.75 - ny * 0.65) * waveForce * 16.0;
              tiltAcc += torque;
            }
          }
        }
      }

      // Semi-implicit Euler integration
      dyn.bobVel += bobAcc * dt;
      dyn.bob = Math.max(0, Math.min(1.4, dyn.bob + dyn.bobVel * dt));

      dyn.tiltVel += tiltAcc * dt;
      dyn.tilt = Math.max(-0.35, Math.min(0.35, dyn.tilt + dyn.tiltVel * dt));

      dyn.pushVelX += pushAccX * dt;
      dyn.pushVelY += pushAccY * dt;
      dyn.pushX = Math.max(-20, Math.min(20, dyn.pushX + dyn.pushVelX * dt));
      dyn.pushY = Math.max(-20, Math.min(20, dyn.pushY + dyn.pushVelY * dt));

      const baseCenterX =
        placement.x + Math.sin(time * 0.12 + leaf.phase) * LOTUS.driftX;
      const baseCenterY =
        placement.y +
        Math.cos(time * 0.15 + leaf.phase * 1.3) * LOTUS.driftY;
      const baseSway =
        Math.sin(time * 0.085 + leaf.phase) * LOTUS.rotationAmount;
      const basePulse = 1 + Math.sin(time * 0.11 + leaf.phase) * 0.012;

      const finalCenterX = baseCenterX + dyn.pushX;
      const finalCenterY = baseCenterY + dyn.pushY;
      const finalSway = baseSway + dyn.tilt;
      const finalScale = basePulse * (1 + dyn.bob * 0.18);

      const center = this.leafCenters[leafIndex];
      center.x = finalCenterX;
      center.y = finalCenterY;

      mesh.group.position.set(finalCenterX, finalCenterY, 0);
      mesh.group.rotation.z = finalSway;
      mesh.group.scale.setScalar(finalScale);

      const shadowLift = 1 + dyn.bob * 0.85;
      mesh.shadowMesh.position.set(
        finalCenterX + shadowOffset.x * shadowLift,
        finalCenterY + shadowOffset.y * shadowLift,
        0,
      );
      mesh.shadowMesh.rotation.z = finalSway;
      mesh.shadowMesh.scale.setScalar(finalScale * 1.02);
    }

    for (const [flowerIndex, mesh] of this.flowers.entries()) {
      const flower = LOTUS_FLOWERS[flowerIndex];
      const leaf = LOTUS_LEAVES[flower.leafIndex];
      const visible =
        flowerIndex < visibleFlowerCount &&
        flower.leafIndex < visibleLeafCount &&
        leaf !== undefined &&
        this.leafCenters[flower.leafIndex] !== undefined;
      mesh.mesh.visible = visible;
      if (!visible) continue;

      const dyn = this.leafDynamics[flower.leafIndex];
      const center = this.leafCenters[flower.leafIndex];
      mesh.mesh.position.set(
        center.x + flower.offsetX,
        center.y + flower.offsetY,
        0,
      );
      const flowerScale = 1 + (dyn ? dyn.bob * 0.16 : 0);
      mesh.mesh.scale.setScalar(flowerScale);
      mesh.mesh.rotation.z =
        Math.sin(time * 0.12 + leaf.phase) * 0.04 + (dyn ? dyn.tilt * 0.75 : 0);
    }
  }

  private rebuild(): void {
    this.disposeMeshes();

    const leaves: LotusLeafMesh[] = [];
    for (const [leafIndex, leaf] of LOTUS_LEAVES.entries()) {
      const palette = PALETTES[
        ((leaf.palette % PALETTES.length) + PALETTES.length) % PALETTES.length
      ];
      const radius = leaf.radius * LOTUS.radiusScale;
      const origin = { x: 0, y: 0 };

      // Leaf triangles come first so the shadow can draw just that range of
      // the same position buffer (the center circle would double-blend).
      const leafBuilder = new LotusGeometryBuilder();
      this.drawLeaf(leafBuilder, origin, radius, leaf.angle, leaf.phase, palette);
      const leafTriangleVertices = leafBuilder.vertexCount;
      leafBuilder.circle(origin, Math.max(1, radius * 0.075), palette.center);
      const leafGeometry = leafBuilder.toGeometry(`lotus leaf ${leafIndex}`);

      const shadowGeometry = new THREE.BufferGeometry();
      shadowGeometry.setAttribute("position", leafGeometry.getAttribute("position"));
      shadowGeometry.setDrawRange(0, leafTriangleVertices);
      shadowGeometry.name = `lotus shadow ${leafIndex}`;

      const veinBuilder = new LotusGeometryBuilder();
      this.drawVeins(veinBuilder, origin, radius, leaf.angle, leaf.phase, palette);
      const veinGeometry = veinBuilder.toGeometry(`lotus veins ${leafIndex}`);

      const leafMesh = new THREE.Mesh(leafGeometry, this.leafMaterial);
      const veins = new THREE.LineSegments(veinGeometry, this.veinMaterial);
      const shadowMesh = new THREE.Mesh(shadowGeometry, this.shadowMaterial);
      leafMesh.frustumCulled = false;
      veins.frustumCulled = false;
      shadowMesh.frustumCulled = false;
      leafMesh.renderOrder = 1;
      veins.renderOrder = 2;

      const group = new THREE.Group();
      group.add(leafMesh, veins);
      this.group.add(group);
      this.shadowGroup.add(shadowMesh);
      leaves.push({
        group,
        shadowMesh,
        geometries: [leafGeometry, shadowGeometry, veinGeometry],
      });
    }
    this.leaves = leaves;
    this.leafCenters = leaves.map(() => ({ x: 0, y: 0 }));
    while (this.leafDynamics.length < leaves.length) {
      this.leafDynamics.push({
        bob: 0,
        bobVel: 0,
        tilt: 0,
        tiltVel: 0,
        pushX: 0,
        pushY: 0,
        pushVelX: 0,
        pushVelY: 0,
      });
    }

    const flowers: LotusFlowerMesh[] = [];
    for (const [flowerIndex, flower] of LOTUS_FLOWERS.entries()) {
      const builder = new LotusGeometryBuilder();
      this.drawFlower(
        builder,
        { x: 0, y: 0 },
        flower.radius * LOTUS.flowerRadiusScale,
        flower.rotation,
        FLOWER_PALETTES[
          ((flower.palette % FLOWER_PALETTES.length) +
            FLOWER_PALETTES.length) %
            FLOWER_PALETTES.length
        ],
      );
      const geometry = builder.toGeometry(`lotus flower ${flowerIndex}`);
      const mesh = new THREE.Mesh(geometry, this.flowerMaterial);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      flowers.push({ mesh, geometry });
    }
    this.flowers = flowers;
  }

  private disposeMeshes(): void {
    for (const leaf of this.leaves) {
      this.group.remove(leaf.group);
      this.shadowGroup.remove(leaf.shadowMesh);
      for (const geometry of leaf.geometries) geometry.dispose();
    }
    for (const flower of this.flowers) {
      this.group.remove(flower.mesh);
      flower.geometry.dispose();
    }
    this.leaves = [];
    this.flowers = [];
    this.leafCenters = [];
  }

  private edgePoint(
    center: Point,
    radius: number,
    angle: number,
    phase: number,
  ): Point {
    const wobble =
      1 + Math.sin(angle * 3 + phase) * 0.035 + Math.cos(angle * 5 - phase) * 0.025;
    return {
      x: center.x + Math.cos(angle) * radius * wobble,
      y: center.y + Math.sin(angle) * radius * LOTUS.verticalScale * wobble,
    };
  }

  private drawLeaf(
    builder: LotusGeometryBuilder,
    center: Point,
    radius: number,
    angle: number,
    phase: number,
    palette: LeafPalette,
  ): void {
    const start = angle + LOTUS.notchHalfAngle;
    const span = TAU - LOTUS.notchHalfAngle * 2;

    this.leafCenterColor.copy(palette.center);

    for (let index = 0; index < LOTUS.leafSegments; index += 1) {
      const angleA = start + (index / LOTUS.leafSegments) * span;
      const angleB = start + ((index + 1) / LOTUS.leafSegments) * span;
      this.leafColorAt(this.leafEdgeColorA, palette, angleA, phase);
      this.leafColorAt(this.leafEdgeColorB, palette, angleB, phase);
      builder.triangleColors(
        center,
        this.edgePoint(center, radius, angleA, phase),
        this.edgePoint(center, radius, angleB, phase),
        this.leafCenterColor,
        this.leafEdgeColorA,
        this.leafEdgeColorB,
      );
    }
  }

  private leafColorAt(
    target: THREE.Color,
    palette: LeafPalette,
    angle: number,
    phase: number,
  ): void {
    const directionalLight = 0.5 + Math.cos(angle + 2.2) * 0.42;
    const organicVariation = Math.sin(angle * 3 + phase * 0.7) * 0.045;
    const tone = Math.max(0, Math.min(1, directionalLight + organicVariation));
    if (tone < 0.5) {
      target.copy(palette.shade).lerp(palette.base, tone * 2);
      return;
    }
    target.copy(palette.base).lerp(palette.light, (tone - 0.5) * 2);
  }

  private drawVeins(
    builder: LotusGeometryBuilder,
    center: Point,
    radius: number,
    angle: number,
    phase: number,
    palette: LeafPalette,
  ): void {
    const start = angle + LOTUS.notchHalfAngle;
    const span = TAU - LOTUS.notchHalfAngle * 2;
    for (let index = 1; index <= LOTUS.veinCount; index += 1) {
      const veinAngle = start + (index / (LOTUS.veinCount + 1)) * span;
      builder.line(
        center,
        this.edgePoint(center, radius * 0.68, veinAngle, phase),
        palette.vein,
      );
    }
  }

  private drawFlower(
    builder: LotusGeometryBuilder,
    center: Point,
    radius: number,
    rotation: number,
    palette: FlowerPalette,
  ): void {
    const drawPetalRing = (
      count: number,
      length: number,
      width: number,
      angleOffset: number,
      primary: THREE.Color,
      alternate: THREE.Color,
    ): void => {
      for (let index = 0; index < count; index += 1) {
        const angle = rotation + angleOffset + (index / count) * TAU;
        const direction = { x: Math.cos(angle), y: Math.sin(angle) };
        const side = { x: -direction.y, y: direction.x };
        const base = {
          x: center.x + direction.x * radius * 0.12,
          y: center.y + direction.y * radius * 0.12,
        };
        const tip = {
          x: center.x + direction.x * radius * length,
          y: center.y + direction.y * radius * length,
        };
        const halfWidth = radius * width;
        const color = index % 3 === 0 ? alternate : primary;
        builder.triangle(
          {
            x: base.x + side.x * halfWidth,
            y: base.y + side.y * halfWidth,
          },
          tip,
          {
            x: base.x - side.x * halfWidth,
            y: base.y - side.y * halfWidth,
          },
          color,
        );
      }
    };

    drawPetalRing(8, 1, 0.22, 0, palette.outerPetal, palette.petalLight);
    drawPetalRing(
      6,
      0.66,
      0.19,
      Math.PI / 6,
      palette.innerPetal,
      palette.petalLight,
    );
    builder.circle(center, radius * 0.28, palette.centerDark);
    builder.circle(center, radius * 0.18, palette.center);
  }
}
