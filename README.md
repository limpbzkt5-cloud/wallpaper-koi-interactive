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

[Features](#-key-features) • [Installation](#-installation-guide) • [Controls](#-interactive-controls) • [Customization](#-customization-reference) • [Physics & Math](#-mathematical--computational-model) • [Development](#-development--scripts)

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

### ⚡ Performance & Battery Efficiency
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

## 🎮 Interactive Controls

| Interaction / Key | Action | Effect |
| :--- | :--- | :--- |
| **Left Click / Tap** | Click on pond surface | Generates circular water ripples; nudges nearby lotus leaves and duckweed |
| **Click & Drag (Water)** | Move mouse across surface | Generates continuous hydrodynamic ripples; fish naturally react and navigate |
| **Click Gramophone** | Tap boat brass horn / record | Toggles audio playback (ambient stream / soundtrack) with volume ramping |
| **Click Boat Feeder** | Tap food compartment | Launches floating food pellets into the pond near the boat |
| **Drag Boat** | Drag boat across pond | Repositions the boat with fluid inertia; smoothly returns to cruising orbit |
| **`B`** | Drop boat feed pellets | Drops food pellets from the boat directly into the pond |
| **`N` / `P`** | Next / Previous track | Cycles between available ambient soundtrack selections |
| **`O` / `=`** | Transform Abyssal | Immediately transforms a koi into the mythic **Abyssal Mutation** |
| **`1` – `0`** | Mutation Hotkeys | Fast-transforms a koi (1: Crimson, 2: Bunny, 3: Aurora, 4: Umbra, 5: Midas, 6: Electric, 7: Frozen, 8: Nuclear, 9: Mythical, 0: Rainbow Cluster) |
| **`U`, `I`, `S`, `A`, `M`**| Mutation Hotkeys | Umbra (`U`), Ishmael (`I`), Serene (`S`), Astraeus (`A`), or target fish (`M`) |
| **`-` / `~`** | Clear Mutation | Reverts transformed fish back to standard koi coloration |
| **`Space`** | Scatter koi | Smooth impulse gently dispersing fish outward across the pond |
| **`[` / `]`** | Adjust fish population | Decreases / increases koi count in real-time |
| **`C`** | Cycle clock modes | Toggles between `Submerged`, `Floating`, and `Off` |
| **`R`** | Reset pond | Re-seeds school genetics, positions, and mutations |
| **`D`** | Toggle debug HUD | Displays real-time telemetry, FPS, and boid parameters |

---

## ⚙️ Customization Reference

| Property Key | Control Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `weather` | Dropdown | `Sunny` | Diurnal lighting and water caustics preset |
| `clock_enabled` | Checkbox | `true` | Display frosted glass pond clock |
| `clock_mode` | Dropdown | `Submerged` | `Submerged` (underwater caustics), `Floating` (surface HUD), or `Off` |
| `clock_format` | Dropdown | `24-Hour` | Standard 24h or 12h (AM/PM) format |
| `clock_seconds` | Checkbox | `false` | Auxiliary seconds counter badge |
| `clock_opacity` | Slider | `45%` | Transparency level of the frosted glass (10%–100%) |
| `clock_position` | Dropdown | `Center` | Screen anchor: Center, Top-Right, Top-Left, Bottom-Center |
| `boat_scale` | Slider | `100%` | Funamori pixel boat scale (0%–200%; set to 0% to hide boat) |
| `boat_speed` | Slider | `100%` | Orbit cruising speed of the boat (0%–200%; 0% pauses movement) |
| `boat_position` | Dropdown | `Right Pond` | Anchor preset: Right Pond, Left Pond, Top Right, Bottom Center |
| `koicount` | Slider | `16` | Total koi fish count (1 to 48) |
| `rain` | Checkbox | `false` | Raindrops and surface wave perturbations |
| `sound` | Checkbox | `false` | Ambient river stream audio loop |
| `framerate` | Dropdown | `Native` | Frame rate limiter: Native, 60, 45, or 30 FPS |
| `visitorfrequency`| Dropdown | `Balanced` | Frequency of rare nomadic visitor fish appearances |
| `mutationchance` | Slider | `70%` | Probability of koi metamorphosing during cycle intervals |
| `allow_abyssal` | Checkbox | `true` | Enable rare Abyssal deep-trench koi mutation |
| `allow_*` | Checkboxes | `true` | Individual toggles for each of the 14 legendary mutations |

---

## 📐 Mathematical & Computational Model

### 1. 2D Hydrodynamic Shallow Water Wave Equation
Water surface displacement $h(x, y, t)$ is modeled using a finite-difference discretization of the 2D wave equation with viscous damping:
$$\frac{\partial^2 h}{\partial t^2} = c^2 \left(\frac{\partial^2 h}{\partial x^2} + \frac{\partial^2 h}{\partial y^2}\right) - \gamma \frac{\partial h}{\partial t}$$
Where $c$ is the wave propagation speed and $\gamma$ denotes viscous dissipation.

### 2. Frosted Glass Surface Normals & Specular Rim Optics
Character bevel normal vectors are evaluated via central differences on the font texture alpha channel:
$$\vec{n}_{\text{bevel}} = \left(\frac{\alpha_{x+1} - \alpha_{x-1}}{2}, \frac{\alpha_{y+1} - \alpha_{y-1}}{2}\right)$$
Specular gleam along the rounded glass perimeter is computed using a directional Blinn-Phong term:
$$\text{SpecularRim} = \max\left(0, \vec{n}_{\text{bevel}} \cdot (-\vec{L})\right)^{2.5} \times \text{smoothstep}(0.10, 0.50, \|\vec{n}_{\text{bevel}}\|)$$

### 3. Biomechanical Spline Kinematics & Curvature Safety
Each fish spine is represented by 10 connected vertebral nodes. The angular deflection between adjacent vertebrae $\Delta \theta_i$ is strictly constrained:
$$\sum_{i=1}^{9} |\Delta \theta_i| \le \theta_{\text{max}} = 52.7^\circ$$
Preventing unnatural body curvature and mesh intersection during rapid turns.

### 4. Proximity Feeding & Hydrodynamic Suction Dynamics
Food pellets float with surface friction. When a koi's mouth position $\vec{m}_j$ enters proximity radius $R_{\text{prox}}$, an attractive hydrodynamic suction force accelerates the pellet toward the fish's oral cavity:
$$\vec{F}_{\text{suction}} = -k_{\text{suction}} \cdot \frac{\vec{p} - \vec{m}_j}{\|\vec{p} - \vec{m}_j\| + \epsilon}$$
When the distance satisfies $\|\vec{p} - \vec{m}_j\| \le R_{\text{eat}}$, the pellet is consumed, triggering an authentic head gulp animation and a localized mouth ripple ring.

### 5. Sinusoidal Dispersal Envelope & Gentle Schooling Dynamics
Following feeding or user interaction, clustered fish disperse smoothly across the pond after a 5.0-second delay. The dispersal intensity follows a sinusoidal ease-in/ease-out envelope over duration $T = 6.0\,\text{s}$:
$$I_{\text{scatter}}(\tau) = I_{\text{peak}} \cdot \sin(\pi \tau), \quad \tau = \operatorname{clamp}\left(1 - \frac{t_{\text{remaining}}}{T}, 0, 1\right)$$
Radial repulsive forces and separation distances scale smoothly with $I_{\text{scatter}}$, ensuring natural, fluid dispersal without discontinuous velocity jumps.

### 6. Hydrodynamic Stern Wake Plume Geometry
As the boat cruises with velocity $\vec{v}(t)$ and normal $\hat{n}(t)$, trailing wake vertices $\vec{r}(t)$ are generated directly behind the stern:
$$w(\xi) = \left(W_{\text{stern}} + W_{\text{diff}} \cdot \xi^{0.5}\right) \cdot (1 - 0.22\,\xi) \cdot \text{scale}, \quad \xi = \frac{a(t)}{\tau_{\text{trail}}} \in [0, 1]$$
Ribbon opacity decays under smooth quadratic damping $\alpha(\xi) = \alpha_0 (1 - \xi^{1.6}) \sin(\pi \xi^{0.75})$, producing an elegant aquatic wake trail.

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
