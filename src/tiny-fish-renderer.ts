import * as THREE from "three";
import { TINY_FISH } from "./config";
import { add, mul, normalize, perpendicular, type Vec2 } from "./math";
import { SurfaceGeometryBatch } from "./surface-geometry";
import { TinyFishSchools, type TinyFishAgent } from "./tiny-fish";

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
    const palette = PALETTES[fish.palette % PALETTES.length];
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
        mul(side, fish.bodyWidth * TINY_FISH.finReachScale * direction),
      );
      this.shapeBatch.triangle(
        finRootForward,
        finTip,
        finBack,
        palette.fin,
      );
    }

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
    const upper = add(tailCenter, mul(side, tailHalfWidth));
    const lower = add(tailCenter, mul(side, -tailHalfWidth));
    const notch = add(
      add(tailRoot, mul(forward, -tailLength * 0.62)),
      mul(side, tailSwing * 0.44),
    );
    const tailColor = palette?.fin;
    batch.triangle(tailRoot, upper, notch, tailColor);
    batch.triangle(tailRoot, notch, lower, tailColor);
  }
}
