# 🎏 Nagomi Koi Pond — Interactive 3D Live Wallpaper

<div align="center">

![Nagomi Koi Preview](./preview.png)

### Procedural Hydrodynamic Koi Simulation for Wallpaper Engine & Lively Wallpaper

[![Three.js](https://img.shields.io/badge/Three.js-r186-blue.svg)](https://threejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/Vitest-96%2F96%20Passing-brightgreen.svg)]()
[![Wallpaper Engine](https://img.shields.io/badge/Wallpaper%20Engine-Compatible-orange.svg)]()
[![Lively Wallpaper](https://img.shields.io/badge/Lively%20Wallpaper-Compatible-cyan.svg)]()
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

*An ethereal, procedural 3D aquatic sanctuary for your desktop. Featuring real-time shallow water wave simulation, Apple-style liquid glass clock optics, hydrodynamic lily pad drift physics, traditional Funamori pixel boat with audio-synced gramophone, V-shaped Kelvin wake ribbons & proximity feeding, diverse pond wildlife, and 14 rare metamorphic koi mutations.*

[Features](#-key-features) • [Installation](#-installation-guide) • [Controls](#-interactive-controls) • [Customization](#-customization-reference) • [Math & Physics](#-mathematical--computational-model) • [Development](#-development--scripts)

</div>

---

## 🌟 Key Features

### 🕒 Apple Liquid Glass Pond Clock
- **Frosted Glassmorphism**: Custom GLSL shader modeling surface normals $\nabla \alpha$, specular rim reflection, internal caustics, and subtle fluid undulation.
- **Dual Display Modes**:
  - `Submerged`: Sits underwater below fish swimming paths; koi fish swim gracefully across the clock face while water caustics play through the glass.
  - `Floating`: A crisp surface HUD resting gently on the water with organic wave buoyancy.
  - `Off`: Completely detaches the clock mesh with **zero draw calls**.
- **Tick Micro-Ripples**: Radiates gentle Gaussian wave pulses from the center with each second transition.
- **Adaptive Weather Lighting**: Automatically adjusts drop shadows, edge gleam, and caustic tints across 7 weather presets.

### 🐟 Biomechanical Spine Kinematics & AI
- **Physiological Cephalocaudal Stiffness Gradient**: Rigid cranial/thoracic cavity transitioning smoothly to flexible caudal fins.
- **Spline Curvature Safety Clamping**: Strict body curvature clamp ($\theta \le 52.7^\circ$) eliminates unnatural mesh pinching or U-shape folding during high-speed turns.
- **Boid Schooling & Avoidance**: Organic schooling, obstacle avoidance around floating ice blocks, and realistic feeding behavior.

### 🌊 Hydrodynamic Water Waves & Floating Flora
- **2D Shallow Water Physics**: Real-time FDTD wave propagation driven by user clicks, swimming fish, and rain.
- **Wave-Induced Plant Drift**: Lotus leaves (water lilies) and duckweed physically bob and glide with the wave flow when water ripples pass beneath them.
- **Wildlife Variety**: Fluttering procedural butterflies across 8 distinct color palettes.

### ⛵ Traditional Funamori Pixel Boat & Vintage Gramophone
- **Artisanal Japanese Woodcraft**: Procedurally rendered pixel boat featuring cypress/cedar hull planks, dark trim, and a bamboo stern rudder drifting organically across the pond.
- **Cohesive Hydrodynamic Stern Wake Trail**:
  - Continuous, graceful wake ribbon and foam bubbles trailing directly behind the stern along the boat's cruising path.
  - Crisp white churned water core with cel-shaded translucent cyan/aqua fringe gradients that smoothly dissipate over time.
  - Peaceful, leisurely cruising speed (~57 seconds per circuit) with orbit locked permanently around the pond center (whether clock is Submerged, Floating, or Off).
- **Audio-Reactive Gramophone**:
  - Classic fluted brass trumpet horn and spinning vinyl record synchronized with audio tempo and FFT frequency energy (via Wallpaper Engine Audio API, Lively, or built-in tracks).
  - Floating golden pixel musical notes (`♪`, `♫`) drift gracefully upward from the horn into the pond mist.
  - Interactive click on the gramophone toggles play/pause with smooth audio volume ramping.
- **Proximity Feeding Mechanism**:
  - Boat carries a feeding compartment (`B` hotkey or clicking the feeder tray).
  - Pellets stay floating on the surface for up to 60 seconds without vanishing prematurely.
  - Koi must physically swim directly to the pellet; upon reaching mouth proximity ($D \le R_{\text{eat}}$), the fish triggers an authentic head gulp animation, hydrodynamic vacuum suction, and radial mouth ripples as the food is devoured.
- **Fluid Drag & Return Dynamics**: Click-and-drag the boat across the water surface with smooth hydrodynamic inertia; releasing it allows it to gently glide back toward its orbital cruising trajectory.

### 🧬 14 Rare Metamorphic Koi Mutations
Koi periodically metamorphose into mythical variants with custom particle effects and shaders:
- **Abyssal** (Mythic): Deep oceanic trench koi cloaked in oscillating bioluminescent dark-abyss hues with glowing floating spores drifting in its wake.
- **Astraeus** (Mythic): Deep cosmic indigo body enveloped in radiant starlight halos.
- **Serene** (Rare): Bioluminescent jade-emerald glow with soothing wake ripples.
- **Umbra** (Mythic): Void silhouette crowned by a rotating 360° solar eclipse corona.
- **Aurora** (Legendary): Shifting polar borealis gradient across scales.
- **Midas** (Legendary): Brilliant 24k molten gold scales.
- **Frozen** (Rare): Trapped inside a floating crystalline ice block that obstacles other fish.
- **Electric**, **Nuclear**, **Mythical**, **Rainbow Cluster**, **Ishmael**, **Crimson**, and **Bunny**.

### 🌤️ 7 Diurnal Weather Presets
- **Sunny**: Bright sunlight with crisp high-contrast caustics.
- **Sunset**: Warm dusk amber glow with lengthened shadows.
- **Moonlight**: Bioluminescent night with soft lunar tones.
- **Rain**: Dynamic raindrops and surface ripple rings.
- **Overcast**: Soft diffused cloud cover.
- **Mist**: Atmospheric morning fog.
- **Deep Clear**: Vibrant cyan tropical lagoon.

### ⚡ 0% GPU Background Suspension
- **Smart Power Saving**: Automatically pauses rendering when full-screen 3D games or applications are active, preserving 100% of gaming performance.
- **FPS Limiter**: Native (Uncapped), 60 FPS, 45 FPS, and 30 FPS options to save laptop battery.

---

## 🚀 Installation Guide

### Option 1: Lively Wallpaper (Free & Open Source)

#### Step 1: Install Wallpaper
- **Method A (Drag & Drop Package — Recommended)**:
  1. Download [`NagomiKoi.livelypack`](./NagomiKoi.livelypack) from the repository root.
  2. Open **Lively Wallpaper**.
  3. **Drag and drop** `NagomiKoi.livelypack` directly into the Lively Wallpaper window (or click **Add Wallpaper (+)** ➔ **Browse** ➔ select `NagomiKoi.livelypack`).
  4. Click **OK** to set it as your active desktop wallpaper!
- **Method B (Local Developer Sync)**:
  - Double-click [`Sync-Lively-Wallpaper.bat`](./Sync-Lively-Wallpaper.bat) or run `npm run sync:lively`.

#### Step 2: Customizing Settings in Lively
1. In Lively Wallpaper, find **Nagomi Koi** in your library.
2. Click the three dots `...` (or right-click) ➔ Select **Customise Wallpaper**.
3. All options are logically grouped with real-time preview and **help tooltips** on hover:
   - **Environment**: Weather preset, rain ripples, ambient stream audio.
   - **Clock**: Apple Liquid Glass clock, submerged/floating mode, 12h/24h format, seconds badge, opacity, screen position.
   - **Funamori Boat**: Scale slider (0%–200%), orbit speed slider (0%–200%), anchor preset positions (Right, Left, Top Right, Bottom Center).
   - **Pond & Fish**: Koi population slider (1–48), *Scatter Koi* button, *Reset Pond* button.
   - **Performance**: Frame rate cap (Native, 60, 45, 30 FPS).
   - **Mutations**: Metamorphosis chance, cycle interval, and toggles for all 14 legendary mutations (including Abyssal).

#### Step 3: Lively Wallpaper Tips
- **Mouse Waves**: Ensure **Lively Settings ➔ Wallpaper ➔ Input ➔ Mouse Interaction** is set to *Enabled*.
- **Audio**: Ambient river stream audio is muted by default; check the *Ambient River Audio* checkbox and make sure *Lively Settings ➔ Audio ➔ Volume* is up.

---

### Option 2: Wallpaper Engine (Steam)

#### 1-Click Automatic Install:
1. Double-click [`Sync-Wallpaper-Engine.bat`](./Sync-Wallpaper-Engine.bat) in the repository root.
2. The script compiles the project and links it directly into your Wallpaper Engine directory:
   `C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\projects\myprojects\nagomi_koi`
3. Open Wallpaper Engine and select **Interactive Koi Pond**!

#### Manual Install:
1. Clone or download this repository.
2. Run `npm install && npm run build`.
3. Copy the contents of `dist/` along with `project.json` and `preview.png` into:
   `C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\projects\myprojects\nagomi_koi\`
4. Launch Wallpaper Engine.

---

### Option 3: Synchronize Both Platforms Simultaneously
If you have both Wallpaper Engine and Lively Wallpaper installed:
- Double-click [`Sync-All-Wallpapers.bat`](./Sync-All-Wallpapers.bat) or run:
  ```bash
  npm run sync:all
  ```

---

## 🎮 Interactive Controls

| Interaction / Key | Action | Effect |
| :--- | :--- | :--- |
| **Left Click / Tap** | Click anywhere on pond | Generates circular water ripples; nudges nearby lotus leaves and duckweed |
| **Click & Drag (Water)** | Move mouse across surface | Creates continuous hydrodynamic wake trail; koi avoid or follow the wave |
| **Click Gramophone** | Tap boat brass horn / record | Toggles audio playback (ambient river stream / music) with smooth volume ramps |
| **Click Boat Feeder** | Tap sushi / bait container | Launches floating food pellets into the pond near the boat |
| **Drag Boat** | Drag boat across pond | Repositions the boat with fluid inertia; gently returns to cruising orbit on release |
| **`B`** | Drop boat feed pellets | Drops food pellets from the boat directly into the pond |
| **`N` / `P`** | Next / Previous track | Cycles between available ambient soundtrack selections |
| **`O` / `=`** | Metamorphose Abyssal | Immediately transforms a koi into the new mythic **Abyssal Mutation** |
| **`1` – `0`** | Mutation Hotkeys | Fast-transforms a koi (1: Crimson, 2: Bunny, 3: Aurora, 4: Umbra, 5: Midas, 6: Electric, 7: Frozen, 8: Nuclear, 9: Mythical, 0: Rainbow Cluster) |
| **`U`, `I`, `S`, `A`, `M`** | Mutation Hotkeys | Umbra (`U`), Ishmael (`I`), Serene (`S`), Astraeus (`A`), or current target (`M`) |
| **`-` / `~`** | Clear Mutation | Reverts transformed fish back to standard genetics |
| **`Space`** | Scatter koi | Sudden pond-wide panic impulse dispersing all fish outward |
| **`[` / `]`** | Adjust fish population | Decreases / increases koi count in real-time |
| **`C`** | Cycle clock modes | Toggles between `Submerged`, `Floating`, and `Off` |
| **`R`** | Reset pond | Re-seeds school genetics, positions, and mutation rolls |
| **`D`** | Toggle debug HUD | Shows real-time telemetry, FPS, and boid parameters |

---

## ⚙️ Customization Reference

| Property Key | Control Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `weather` | Dropdown | `Sunny` | Diurnal lighting and water caustics preset |
| `clock_enabled` | Checkbox | `true` | Display procedural Apple-style liquid glass clock |
| `clock_mode` | Dropdown | `Submerged` | `Submerged` (underwater refraction), `Floating` (surface HUD), or `Off` |
| `clock_format` | Dropdown | `24-Hour` | Standard 24h or 12h (AM/PM) format |
| `clock_seconds` | Checkbox | `false` | Auxiliary seconds counter badge |
| `clock_opacity` | Slider | `45%` | Transparency level of the frosted glass (10%–100%) |
| `clock_position` | Dropdown | `Center` | Screen anchor: Center, Top-Right, Top-Left, Bottom-Center |
| `boat_scale` | Slider | `100%` | Funamori pixel boat scale (0%–200%; set to 0% to hide boat) |
| `boat_speed` | Slider | `100%` | Orbit cruising speed of the boat (0%–200%; 0% pauses movement) |
| `boat_position` | Dropdown | `Right Pond` | Anchor position preset: Right Pond, Left Pond, Top Right, Bottom Center |
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
Water wave displacement $h(x, y, t)$ is computed via a discretized 2D wave grid:
$$\frac{\partial^2 h}{\partial t^2} = c^2 \left(\frac{\partial^2 h}{\partial x^2} + \frac{\partial^2 h}{\partial y^2}\right) - \gamma \frac{\partial h}{\partial t}$$
Where $c$ represents wave propagation speed and $\gamma$ is viscous damping.

### 2. Apple Liquid Glass Shader & Specular Rim Optics
Character bevel normals are derived via central differences on the text texture alpha channel:
$$\vec{n}_{\text{bevel}} = \left(\frac{\alpha_{x+1} - \alpha_{x-1}}{2}, \frac{\alpha_{y+1} - \alpha_{y-1}}{2}\right)$$
The specular gleam on the rounded glass rim is computed via Blinn-Phong directional reflection:
$$\text{SpecularRim} = \max\left(0, \vec{n}_{\text{bevel}} \cdot (-\vec{L})\right)^{2.5} \times \text{smoothstep}(0.10, 0.50, \|\vec{n}_{\text{bevel}}\|)$$

### 3. Spline Spine Kinematics & Curvature Safety
Each koi body is represented by a sequence of 10 vertebral segments. Angular deflection between adjacent vertebrae $\Delta \theta_i$ satisfies:
$$\sum_{i=1}^{9} |\Delta \theta_i| \le \theta_{\text{max}} = 52.7^\circ$$
Guaranteeing realistic fish swimming contours with zero self-intersection.

### 4. Proximity Koi Feeding & Hydrodynamic Suction
Food pellets $\vec{p}$ float on the pond surface with viscous water damping. When a koi's mouth position $\vec{m}_j$ approaches within proximity threshold $R_{\text{prox}}$, an attractive hydrodynamic suction force accelerates the pellet toward the fish's oral cavity:
$$\vec{F}_{\text{suction}} = -k_{\text{suction}} \cdot \frac{\vec{p} - \vec{m}_j}{\|\vec{p} - \vec{m}_j\| + \epsilon}$$
When the Euclidean distance satisfies $\|\vec{p} - \vec{m}_j\| \le R_{\text{eat}}$, the pellet is consumed, triggering an authentic biomechanical head gulp animation, a localized mouth ripple ring, and resetting the fish's satiation cooldown.

### 5. FFT Audio Energy & Vinyl Angular Velocity
The rotation rate of the boat's vintage gramophone vinyl record $\omega(t)$ couples directly to the normalized audio spectral energy:
$$\omega(t) = \omega_{\text{idle}} + \Delta\omega \cdot \bar{E}_{\text{audio}}(t), \quad \bar{E}_{\text{audio}}(t) = \frac{1}{N}\sum_{k=1}^{N} |X_k(t)|$$
Where $X_k(t)$ denotes the discrete Fourier transform (FFT) frequency bins provided by the Wallpaper Engine audio bus or in-app audio context.

### 6. Hydrodynamic Stern Wake Trail & Ribbon Geometry
As the boat cruises with velocity $\vec{v}(t)$ and lateral unit normal $\hat{n}(t)$, trailing wake vertices $\vec{r}(t)$ track directly behind the stern along its trajectory:
$$w(\xi) = \left(W_{\text{stern}} + W_{\text{diff}} \cdot \xi^{0.5}\right) \cdot (1 - 0.22\,\xi) \cdot \text{scale}, \quad \xi = \frac{a(t)}{\tau_{\text{trail}}} \in [0, 1]$$
Ribbon opacity decays gracefully under smooth quadratic damping $\alpha(\xi) = \alpha_0 (1 - \xi^{1.6}) \sin(\pi \xi^{0.75})$ to produce an unbroken, ethereal aquatic wake trail.

---

## 🛠️ Development & Scripts

```bash
# Install dependencies
npm install

# Start local development server with Vite HMR
npm run dev

# Run full Vitest test suite (96 tests)
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
