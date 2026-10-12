import * as THREE from "three";
import { TINY_FISH } from "./config";
import { add, mul, normalize, perpendicular, type Vec2 } from "./math";
import { SurfaceGeometryBatch } from "./surface-geometry";
import { TinyFishSchools, type TinyFishAgent, TinyFishSpecies } from "./tiny-fish";

interface TinyFishPalette {
  body: THREE.Color;
  light: THREE.Color;
  accent: THREE.Color;
  fin: THREE.Color;
  eye: THREE.Color;
}

const PALETTES: readonly TinyFishPalette[] = TINY_FISH.palettes.map(
  (palette) => ({
    body: new THREE.Color(palette.body),
    light: new THREE.Color(palette.light),
    accent: new THREE.Color(palette.accent),
    fin: new THREE.Color(palette.fin),
    eye: new THREE.Color(palette.eye),
  }),
);

const SPECIES_PALETTES: Record<TinyFishSpecies, TinyFishPalette> = {
  [TinyFishSpecies.Medaka]: {
    body: new THREE.Color(0xf6d365),
    light: new THREE.Color(0xfff5cc),
    accent: new THREE.Color(0xe67e22),
    fin: new THREE.Color(0xfad390),
    eye: new THREE.Color(0x2d3436),
  },
  [TinyFishSpecies.NeonDanio]: {
    body: new THREE.Color(0x2e59ba),
    light: new THREE.Color(0x54a0ff),
    accent: new THREE.Color(0x00d2d3),
    fin: new THREE.Color(0x48dbfb),
    eye: new THREE.Color(0x130f40),
  },
  [TinyFishSpecies.RosyBitterling]: {
    body: new THREE.Color(0xf78fb3),
    light: new THREE.Color(0xf8a5c2),
    accent: new THREE.Color(0xf5cd79),
    fin: new THREE.Color(0xfc5c65),
    eye: new THREE.Color(0x303952),
  },
  [TinyFishSpecies.GhostMinnow]: {
    body: new THREE.Color(0xdfe4ea),
    light: new THREE.Color(0xf1f2f6),
    accent: new THREE.Color(0xa4b0be),
    fin: new THREE.Color(0xced6e0),
    eye: new THREE.Color(0x2f3542),
  },
  [TinyFishSpecies.EmeraldRasbora]: {
    body: new THREE.Color(0x20bf6b),
    light: new THREE.Color(0x26de81),
    accent: new THREE.Color(0xf7b731),
    fin: new THREE.Color(0xfa8231),
    eye: new THREE.Color(0x1e272e),
  },
};

export class TinyFishRenderer {
  public readonly shadowGroup = new THREE.Group();
  public readonly group = new THREE.Group();

  private readonly shadowGeometry = new THREE.BufferGeometry();
  private readonly shapeGeometry = new THREE.BufferGeometry();
  private readonly detailGeometry = new THREE.BufferGeometry();
  private readonly shadowMaterial = new THREE.MeshBasicMaterial({
    color: TINY_FISH.shadow.color,
    opacity: TINY_FISH.shadow.opacity,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly shadowBatch = new SurfaceGeometryBatch(
    this.shadowGeometry,
    16_384,
  );
  private readonly shapeBatch = new SurfaceGeometryBatch(
    this.shapeGeometry,
    32_768,
    true,
  );
  private readonly detailBatch = new SurfaceGeometryBatch(
    this.detailGeometry,
    24_576,
    true,
  );

  public constructor() {
    this.shadowGeometry.name = "tiny fish shadows";
    this.shapeGeometry.name = "tiny fish silhouettes";
    this.detailGeometry.name = "tiny fish markings";

    const colorMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    const shadowMesh = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    const shapeMesh = new THREE.Mesh(this.shapeGeometry, colorMaterial);
    const detailMesh = new THREE.Mesh(this.detailGeometry, colorMaterial);
    shadowMesh.frustumCulled = false;
    shapeMesh.frustumCulled = false;
    detailMesh.frustumCulled = false;
    shadowMesh.renderOrder = 1;
    shapeMesh.renderOrder = 4;
    detailMesh.renderOrder = 5;
    this.shadowGroup.add(shadowMesh);
    this.group.add(shapeMesh, detailMesh);
    this.refreshConfig();
  }

  public refreshConfig(): void {
    this.shadowMaterial.color.setHex(TINY_FISH.shadow.color);
    this.shadowMaterial.opacity = TINY_FISH.shadow.opacity;
    for (const [index, palette] of TINY_FISH.palettes.entries()) {
      const target = PALETTES[index];
      if (!target) continue;
      target.body.setHex(palette.body);
      target.light.setHex(palette.light);
      target.accent.setHex(palette.accent);
      target.fin.setHex(palette.fin);
      target.eye.setHex(palette.eye);
    }
  }

  public update(schools: TinyFishSchools): void {
    this.shadowBatch.reset();
    this.shapeBatch.reset();
    this.detailBatch.reset();

    for (const fish of schools.fish) {
      if (fish.schoolIndex >= TINY_FISH.visibleSchoolCount) continue;
      this.drawFish(fish);
    }

    this.shadowBatch.commit();
    this.shapeBatch.commit();
    this.detailBatch.commit();
  }

  private drawFish(fish: TinyFishAgent): void {
    const palette = SPECIES_PALETTES[fish.species] ?? PALETTES[fish.palette % PALETTES.length];
    const forward = normalize(fish.velocity);
    const side = perpendicular(forward);
    const shadowCenter = add(fish.position, TINY_FISH.shadow.offset);

    this.drawBody(
      this.shadowBatch,
      shadowCenter,
      forward,
      side,
      fish,
    );
    this.drawBody(
      this.shapeBatch,
      fish.position,
      forward,
      side,
      fish,
      palette,
    );

    const finReach = fish.species === TinyFishSpecies.RosyBitterling
      ? TINY_FISH.finReachScale * 1.15
      : fish.species === TinyFishSpecies.GhostMinnow
        ? TINY_FISH.finReachScale * 0.85
        : TINY_FISH.finReachScale;

    const finRootForward = add(
      fish.position,
      mul(forward, fish.bodyLength * 0.02),
    );
    const finBack = add(
      fish.position,
      mul(forward, -fish.bodyLength * 0.18),
    );
    for (const direction of [-1, 1]) {
      const finTip = add(
        finRootForward,
        mul(side, fish.bodyWidth * finReach * direction),
      );
      this.shapeBatch.triangle(
        finRootForward,
        finTip,
        finBack,
        palette.fin,
      );
    }

    if (fish.species === TinyFishSpecies.NeonDanio) {
      // Radiant iridescent dorsal spine streak
      const streakStart = add(fish.position, mul(forward, fish.bodyLength * 0.28));
      const streakEnd = add(fish.position, mul(forward, -fish.bodyLength * 0.30));
      const streakHalfWidth = fish.bodyWidth * 0.36;
      this.detailBatch.triangle(
        add(streakStart, mul(side, streakHalfWidth)),
        add(streakStart, mul(side, -streakHalfWidth)),
        add(streakEnd, mul(side, -streakHalfWidth)),
        palette.accent,
      );
      this.detailBatch.triangle(
        add(streakStart, mul(side, streakHalfWidth)),
        add(streakEnd, mul(side, -streakHalfWidth)),
        add(streakEnd, mul(side, streakHalfWidth)),
        palette.accent,
      );
    } else if (fish.species === TinyFishSpecies.GhostMinnow) {
      // Ethereal silver visceral pearl
      this.detailBatch.circle(
        add(fish.position, mul(forward, fish.bodyLength * 0.05)),
        Math.max(0.2, fish.bodyWidth * 0.32),
        palette.accent,
        4,
      );
    } else {
      const stripeFront = add(
        fish.position,
        mul(forward, fish.bodyLength * 0.08),
      );
      const stripeBack = add(
        fish.position,
        mul(forward, -fish.bodyLength * 0.09),
      );
      const stripeWidth = fish.bodyWidth * 0.78;
      this.detailBatch.triangle(
        add(stripeFront, mul(side, stripeWidth)),
        add(stripeFront, mul(side, -stripeWidth)),
        add(stripeBack, mul(side, -stripeWidth)),
        palette.accent,
      );
      this.detailBatch.triangle(
        add(stripeFront, mul(side, stripeWidth)),
        add(stripeBack, mul(side, -stripeWidth)),
        add(stripeBack, mul(side, stripeWidth)),
        palette.accent,
      );
    }

    const eyeForward = add(
      fish.position,
      mul(forward, fish.bodyLength * 0.31),
    );
    for (const direction of [-1, 1]) {
      this.detailBatch.circle(
        add(eyeForward, mul(side, fish.bodyWidth * 0.58 * direction)),
        TINY_FISH.eyeRadius,
        palette.eye,
        5,
      );
    }
  }

  private drawBody(
    batch: SurfaceGeometryBatch,
    center: Vec2,
    forward: Vec2,
    side: Vec2,
    fish: TinyFishAgent,
    palette?: TinyFishPalette,
  ): void {
    const nose = add(center, mul(forward, fish.bodyLength * 0.5));
    const frontLeft = add(
      add(center, mul(forward, fish.bodyLength * 0.16)),
      mul(side, fish.bodyWidth),
    );
    const frontRight = add(
      add(center, mul(forward, fish.bodyLength * 0.16)),
      mul(side, -fish.bodyWidth),
    );
    const backLeft = add(
      add(center, mul(forward, -fish.bodyLength * 0.34)),
      mul(side, fish.bodyWidth * 0.58),
    );
    const backRight = add(
      add(center, mul(forward, -fish.bodyLength * 0.34)),
      mul(side, -fish.bodyWidth * 0.58),
    );
    const tailRoot = add(center, mul(forward, -fish.bodyLength * 0.44));
    const bodyColor = palette?.body;
    const frontColor = palette?.light;
    batch.triangle(nose, frontLeft, center, frontColor);
    batch.triangle(nose, center, frontRight, frontColor);
    batch.triangle(frontLeft, backLeft, center, bodyColor);
    batch.triangle(center, backLeft, backRight, bodyColor);
    batch.triangle(center, backRight, frontRight, bodyColor);
    batch.triangle(backLeft, tailRoot, backRight, bodyColor);

    const tailLength = fish.bodyLength * TINY_FISH.tailLengthScale;
    const tailSwing = Math.sin(fish.tailPhase) * fish.bodyWidth * 0.44;
    const tailCenter = add(
      add(tailRoot, mul(forward, -tailLength)),
      mul(side, tailSwing),
    );
    const tailHalfWidth = fish.bodyWidth * TINY_FISH.tailWidthScale;
    const tailColor = palette?.fin;

    if (fish.species === TinyFishSpecies.RosyBitterling) {
      // Forked caudal fin (đuôi chẻ hai nhánh sắc nét chữ V)
      const forkDepth = tailLength * 0.52;
      const upperTip = add(tailCenter, mul(side, tailHalfWidth * 1.35));
      const lowerTip = add(tailCenter, mul(side, -tailHalfWidth * 1.35));
      const forkCrotch = add(
        add(tailRoot, mul(forward, -tailLength + forkDepth)),
        mul(side, tailSwing * 0.45),
      );
      batch.triangle(tailRoot, upperTip, forkCrotch, tailColor);
      batch.triangle(tailRoot, forkCrotch, lowerTip, tailColor);
    } else {
      const upper = add(tailCenter, mul(side, tailHalfWidth));
      const lower = add(tailCenter, mul(side, -tailHalfWidth));
      const notch = add(
        add(tailRoot, mul(forward, -tailLength * 0.62)),
        mul(side, tailSwing * 0.44),
      );
      batch.triangle(tailRoot, upper, notch, tailColor);
      batch.triangle(tailRoot, notch, lower, tailColor);
    }
  }
}
