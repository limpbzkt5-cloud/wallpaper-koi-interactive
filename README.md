# 🎏 Nagomi Koi Pond — Interactive 3D Live Wallpaper

<div align="center">

![Nagomi Koi Preview](./preview.png)

### Procedural Hydrodynamic Koi Simulation for Wallpaper Engine & Lively Wallpaper

[![Three.js](https://img.shields.io/badge/Three.js-r186-blue.svg)](https://threejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/Vitest-99%2F99%20Passing-brightgreen.svg)]()
[![Wallpaper Engine](https://img.shields.io/badge/Wallpaper%20Engine-Compatible-orange.svg)]()
[![Lively Wallpaper](https://img.shields.io/badge/Lively%20Wallpaper-Compatible-cyan.svg)]()
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

*A procedural 3D aquatic desktop wallpaper featuring real-time shallow water wave simulation, biomechanical spine kinematics, frosted glassmorphism pond clock, artisanal pixel boat with audio-reactive gramophone, hydrodynamic stern wake ribbons, proximity feeding, and 14 mythical koi mutations.*

[Features](#-key-features) • [Installation](#-installation-guide) • [Math & Physics](#-mathematical--computational-model) • [Development](#-development--scripts)

</div>

---

## 🌟 Key Features

### 🌊 Hydrodynamic Shallow Water Waves & Aquatic Flora
- **2D Shallow Water Physics**: Real-time finite-difference (FDTD) wave propagation driven by mouse interaction, swimming fish motion, and raindrops.
- **Wave-Induced Plant Drift**: Lotus leaves (water lilies) and duckweed clusters physically bob, rotate, and glide in response to passing water ripples.
- **Atmospheric Wildlife**: Fluttering procedural butterflies across multiple color palettes drifting gently over the water surface.

### 🐟 Biomechanical Koi Kinematics & Schooling
- **Cephalocaudal Stiffness Gradient**: Anatomical spine curve modeling cranial rigidity transitioning smoothly to flexible caudal fin oscillations.
- **Vertebral Curvature Safety Clamping**: Strict angular deflection bounds ($\sum |\Delta \theta_i| \le 52.7^\circ$) eliminate unnatural mesh pinching or folding during sharp turns.
- **Autonomous Boids Schooling**: Multi-tier flocking algorithm balancing cohesion, alignment, depth-weighted separation, and obstacle avoidance around frozen ice blocks.
- **Smooth Dispersal Dynamics**: Gentle 5-second post-feeding and post-click dispersal governed by a sinusoidal smoothstep envelope, preventing abrupt directional jumps.

### ⛵ Funamori Pixel Boat & Audio Gramophone
- **Artisanal Japanese Craft**: Procedurally rendered pixel boat with cedar hull planks, dark trim, and a bamboo stern rudder cruising in a calm, fixed orbit (~57 seconds per circuit).
- **Hydrodynamic Stern Wake Plume**:
  - Continuous, graceful wake ribbon trailing directly behind the stern along the boat's cruising trajectory.
  - Churned frothy water core with translucent aquatic fringe gradients that smoothly dissipate over time.
- **Audio-Reactive Gramophone**:
  - Brass trumpet horn and spinning vinyl record synchronized with audio tempo and FFT frequency spectrum (via Wallpaper Engine audio bus, Lively, or built-in tracks).
  - Pixel musical notes (`♪`, `♫`) drift upward from the horn into the ambient pond mist.
  - Interactive click on the gramophone toggles audio playback with smooth volume ramps.
- **Proximity Feeding Mechanism**:
  - Food tray drops floating pellets that remain on the water surface with viscous damping.
  - Koi navigate to nearby pellets and consume them with realistic head gulp animations, hydrodynamic suction, and radial mouth ripples.
- **Fluid Drag & Return**: Click-and-drag the boat across the surface with realistic fluid inertia; upon release, it gently glides back to its cruising orbit.

### 🕒 Frosted Glassmorphism Pond Clock
- **Refractive Optics**: Custom GLSL shader with surface normal bevels, Blinn-Phong specular rim reflection, internal caustics, and subtle fluid undulation.
- **Dual Display Modes**:
  - `Submerged`: Positioned underwater beneath swimming fish paths; koi swim across the clock face while caustics play through the glass.
  - `Floating`: Crisp surface HUD resting gently on the water with organic wave buoyancy.
  - `Off`: Completely detaches the clock mesh with **zero draw calls**.
- **Tick Micro-Ripples**: Emits subtle radial Gaussian wave pulses on every second transition.
- **Diurnal Lighting**: Dynamically adapts drop shadows, edge gleam, and caustic tints across 7 weather presets.

### 🧬 14 Metamorphic Koi Mutations
Koi periodically metamorphose into mythical variants with custom particle effects and shaders:
- **Abyssal** (Mythic): Deep oceanic trench koi cloaked in oscillating bioluminescent dark hues with glowing spores.
- **Astraeus** (Mythic): Cosmic indigo body enveloped in radiant starlight halos.
- **Serene** (Rare): Bioluminescent jade-emerald glow with soothing wake ripples.
- **Umbra** (Mythic): Void silhouette crowned by a rotating 360° solar eclipse corona.
- **Aurora** (Legendary): Shifting polar borealis gradient across scales.
- **Midas** (Legendary): Radiant molten gold scales with shimmering flecks.
- **Frozen** (Rare): Encased within a floating crystalline ice block acting as a physical swimming obstacle.
- **Electric**, **Nuclear**, **Mythical**, **Rainbow Cluster**, **Ishmael**, **Crimson**, and **Bunny**.

### 🌤️ 7 Diurnal Weather Presets
- **Sunny**: Crisp direct sunlight with high-contrast caustics.
- **Sunset**: Warm dusk amber glow with lengthened shadows.
- **Moonlight**: Bioluminescent night with cool lunar reflections.
- **Rain**: Dynamic raindrops and surface ripple rings.
- **Overcast**: Soft diffused cloud cover.
- **Mist**: Atmospheric morning fog.
- **Deep Clear**: Vibrant cyan tropical lagoon.

### ⚡ Performance & Adaptive Screen Aspect Ratio
- **Full Viewport Display**: Automatically adapts to any monitor ratio (16:9, 16:10, 21:9 ultrawide, 3:2, 4:3) with 100% full-screen coverage and zero letterbox/pillarbox black bars.
- **0% GPU Background Suspension**: Automatically pauses rendering when full-screen applications or 3D games are active, preserving 100% of GPU resources.
- **Frame Rate Limiter**: Native (Uncapped), 60 FPS, 45 FPS, and 30 FPS options to optimize laptop battery life.

---

## 🚀 Installation Guide

### Option 1: Lively Wallpaper (Free & Open Source)

#### Step 1: Install Wallpaper
- **Method A (Drag & Drop — Recommended)**:
  1. Download [`NagomiKoi.livelypack`](./NagomiKoi.livelypack) from the repository root.
  2. Open **Lively Wallpaper**.
  3. Drag and drop `NagomiKoi.livelypack` into the Lively window (or click **Add Wallpaper (+)** ➔ **Browse** ➔ select `NagomiKoi.livelypack`).
  4. Click **OK** to set it as your active desktop wallpaper.
- **Method B (Local Sync Script)**:
  - Run `npm run sync:lively` or double-click [`Sync-Lively-Wallpaper.bat`](./Sync-Lively-Wallpaper.bat).

#### Step 2: Customizing Settings in Lively
1. In Lively Wallpaper, right-click **Nagomi Koi** in your library ➔ Select **Customise Wallpaper**.
2. Settings are organized into logical groups with real-time preview and tooltips:
   - **Environment**: Weather preset, rain ripples, ambient audio.
   - **Clock**: Display mode (Submerged / Floating / Off), 12h/24h format, seconds counter, opacity, position.
   - **Funamori Boat**: Scale (0%–200%), cruising speed (0%–200%), anchor positions.
   - **Pond & Fish**: Koi population (1–48), scatter trigger, pond reset.
   - **Performance**: Frame rate cap (Native, 60, 45, 30 FPS).
   - **Mutations**: Metamorphosis chance, interval, and toggles for individual mutations.

---

### Option 2: Wallpaper Engine (Steam)

#### 1-Click Automatic Install:
1. Double-click [`Sync-Wallpaper-Engine.bat`](./Sync-Wallpaper-Engine.bat) in the repository root.
2. The script compiles the project and links it directly into your Wallpaper Engine projects directory:
   `C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\projects\myprojects\nagomi_koi`
3. Open Wallpaper Engine and select **Interactive Koi Pond**.

#### Manual Install:
1. Run `npm install && npm run build`.
2. Copy the contents of `dist/` into:
   `C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\projects\myprojects\nagomi_koi\`
3. Open Wallpaper Engine.

---

### Option 3: Synchronize Both Platforms Simultaneously
If you have both Wallpaper Engine and Lively Wallpaper installed:
```bash
npm run sync:all
```
*(Or double-click [`Sync-All-Wallpapers.bat`](./Sync-All-Wallpapers.bat))*

---

## 📐 Mathematical & Computational Model

### 1. 2D Shallow Water Wave Propagation (FDTD)
Surface elevation $h(x, y, t)$ is modeled using a finite-difference time-domain discretization of the 2D acoustic-gravity wave equation with viscous dissipation $\gamma$:

$$\frac{\partial^2 h}{\partial t^2} = c^2 \nabla^2 h - \gamma \frac{\partial h}{\partial t} = c^2 \left(\frac{\partial^2 h}{\partial x^2} + \frac{\partial^2 h}{\partial y^2}\right) - \gamma \frac{\partial h}{\partial t}$$

Discretized over a spatial grid $\Delta x = \Delta y = 1$ with timestep $\Delta t$:

$$h^{t+\Delta t}_{i,j} = (2 - \gamma\Delta t) h^t_{i,j} - (1 - \gamma\Delta t) h^{t-\Delta t}_{i,j} + c^2 \Delta t^2 \left(h^t_{i+1,j} + h^t_{i-1,j} + h^t_{i,j+1} + h^t_{i,j-1} - 4h^t_{i,j}\right)$$

Numerical stability is unconditionally guaranteed under the Courant-Friedrichs-Lewy (CFL) condition:

$$c \frac{\Delta t}{\Delta x} \le \frac{1}{\sqrt{2}}$$

### 2. Biomechanical Spline Kinematics & Curvature Safety
Each koi body is represented by $N = 10$ linked vertebral nodes with segment lengths $\ell_i$. Node $i$ follows preceding node $i-1$ subject to a cephalocaudal stiffness gradient:

$$\mathbf{p}_i = \mathbf{p}_{i-1} - \ell_i \begin{bmatrix} \cos \theta_i \\ \sin \theta_i \end{bmatrix}$$

Total body bending curvature is bounded by an anatomical deflection threshold $\theta_{\max}$:

$$\sum_{i=1}^{N-1} |\theta_i - \theta_{i-1}| \le \theta_{\max} = 52.7^\circ$$

preventing self-intersection and unnatural mesh folding during high-speed swimming maneuvers.

### 3. Autonomous Schooling & Sinusoidal Dispersal Envelope
Fish steering velocity integrates cohesion, alignment, depth-weighted separation, and obstacle deflection:

$$\mathbf{F}_{\text{steer}} = w_{\text{sep}} \mathbf{F}_{\text{sep}} + w_{\text{align}} \mathbf{F}_{\text{align}} + w_{\text{coh}} \mathbf{F}_{\text{coh}} + \mathbf{F}_{\text{radial}}$$

Following feeding completion or interaction, cluster dispersal is modulated by a smooth sinusoidal envelope over duration $T = 6.0\,\text{s}$:

$$I_{\text{scatter}}(\tau) = I_{\text{peak}} \sin(\pi \tau), \quad \tau = \text{clamp}\left(1 - \frac{t_{\text{remaining}}}{T}, 0, 1\right)$$

Because $I_{\text{scatter}}(0) = I_{\text{scatter}}(1) = 0$ with $\mathcal{C}^1$ continuity, fish disperse across the pond with zero abrupt heading or velocity discontinuities.

### 4. Frosted Glass Normals & Specular Rim Optics
Surface normal vectors $\mathbf{n}_{\text{bevel}}$ are extracted via central difference gradient on font texture alpha channel $\alpha(x, y)$:

$$\mathbf{n}_{\text{bevel}} = \frac{1}{2} \begin{bmatrix} \alpha(x+1, y) - \alpha(x-1, y) \\ \alpha(x, y+1) - \alpha(x, y-1) \end{bmatrix}$$

Specular rim gleam along curved glass bevel contours is evaluated via Blinn-Phong reflectance:

$$I_{\text{rim}} = \max\left(0, \mathbf{n}_{\text{bevel}} \cdot (-\mathbf{L})\right)^{2.5} \times \text{smoothstep}\left(0.10, 0.50, \|\mathbf{n}_{\text{bevel}}\|\right)$$

### 5. Hydrodynamic Stern Wake Plume Geometry
As the boat cruises with planar velocity $\mathbf{v}(t)$ and lateral normal $\hat{\mathbf{n}}(t)$, trailing wake vertices $\mathbf{r}(t)$ expand behind the stern:

$$W(\xi) = \left(W_0 + W_{\text{diff}} \xi^{0.5}\right)(1 - 0.22\xi) \cdot s, \quad \xi = \frac{t_{\text{age}}}{\tau_{\text{trail}}} \in [0, 1]$$

Wake plume opacity decays under quadratic damping $\alpha(\xi) = \alpha_0 (1 - \xi^{1.6}) \sin(\pi \xi^{0.75})$, producing an unbroken aquatic wake trail.

### 6. Adaptive Viewport & Isotropic Resolution Scaling
For any monitor resolution $W_{\text{screen}} \times H_{\text{screen}}$ with aspect ratio $A = W_{\text{screen}} / H_{\text{screen}}$, the pixel-art simulation canvas dynamically sizes as:

$$\begin{cases}
W_{\text{render}} = \text{round}(H_{\text{base}} \cdot A), \quad H_{\text{render}} = H_{\text{base}} = 270 & \text{if } A \ge 1.0 \text{ (Landscape)} \\
W_{\text{render}} = H_{\text{base}} = 270, \quad H_{\text{render}} = \text{round}(H_{\text{base}} / A) & \text{if } A < 1.0 \text{ (Portrait)}
\end{cases}$$

The resulting display scale factors satisfy:

$$S_x = \frac{W_{\text{screen}}}{W_{\text{render}}} = \frac{H_{\text{screen}}}{H_{\text{render}}} = S_y$$

ensuring perfectly isotropic square pixels and complete full-screen coverage with **zero black bars** across all display standards (16:9, 16:10, 21:9 ultrawide, 3:2, 4:3).

---

## 🛠️ Development & Scripts

```bash
# Install dependencies
npm install

# Start local development server with Vite HMR
npm run dev

# Run full Vitest test suite (99 tests)
npm run test

# Compile TypeScript and build production bundle
npm run build

# Synchronize directly to Wallpaper Engine
npm run sync:we

# Synchronize directly to Lively Wallpaper & build .livelypack
npm run sync:lively

# Synchronize both platforms simultaneously
npm run sync:all
```

---

## 📜 License
MIT License. Created with passion for procedural computer graphics and aquatic simulation.
