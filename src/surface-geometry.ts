import * as THREE from "three";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./config";

export interface SurfacePoint {
  x: number;
  y: number;
}

const DEFAULT_COLOR = new THREE.Color(0xffffff);

export class SurfaceGeometryBatch {
  private readonly positions: Float32Array;
  private readonly positionAttribute: THREE.BufferAttribute;
  private readonly colors?: Float32Array;
  private readonly colorAttribute?: THREE.BufferAttribute;
  private cursor = 0;

  public constructor(
    private readonly geometry: THREE.BufferGeometry,
    capacity: number,
    includeColors = false,
  ) {
    this.positions = new Float32Array(capacity);
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", this.positionAttribute);
    this.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5, 0),
      Math.hypot(CANVAS_WIDTH, CANVAS_HEIGHT),
    );

    if (includeColors) {
      this.colors = new Float32Array(capacity);
      this.colorAttribute = new THREE.BufferAttribute(this.colors, 3);
      this.colorAttribute.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute("color", this.colorAttribute);
    }
  }

  public reset(): void {
    this.cursor = 0;
  }

  public point(point: SurfacePoint, color: THREE.Color = DEFAULT_COLOR): void {
    if (this.cursor + 3 > this.positions.length) return;
    this.positions[this.cursor] = point.x;
    this.positions[this.cursor + 1] = point.y;
    this.positions[this.cursor + 2] = 0;
    if (this.colors) {
      this.colors[this.cursor] = color.r;
      this.colors[this.cursor + 1] = color.g;
      this.colors[this.cursor + 2] = color.b;
    }
    this.cursor += 3;
  }

  public triangle(
    a: SurfacePoint,
    b: SurfacePoint,
    c: SurfacePoint,
    color: THREE.Color = DEFAULT_COLOR,
  ): void {
    this.point(a, color);
    this.point(b, color);
    this.point(c, color);
  }

  public line(
    a: SurfacePoint,
    b: SurfacePoint,
    color: THREE.Color = DEFAULT_COLOR,
  ): void {
    this.point(a, color);
    this.point(b, color);
  }

  public circle(
    center: SurfacePoint,
    radius: number,
    color: THREE.Color = DEFAULT_COLOR,
    segments = 8,
  ): void {
    for (let index = 0; index < segments; index += 1) {
      const angleA = (index / segments) * Math.PI * 2;
      const angleB = ((index + 1) / segments) * Math.PI * 2;
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

  public commit(): void {
    this.geometry.setDrawRange(0, this.cursor / 3);
    this.positionAttribute.clearUpdateRanges();
    this.positionAttribute.addUpdateRange(0, this.cursor);
    this.positionAttribute.needsUpdate = true;
    if (this.colorAttribute) {
      this.colorAttribute.clearUpdateRanges();
      this.colorAttribute.addUpdateRange(0, this.cursor);
      this.colorAttribute.needsUpdate = true;
    }
  }
}
