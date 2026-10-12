# 🎏 Nagomi Koi Pond — Interactive Live Wallpaper
### Dynamic Procedural Koi Simulation for Wallpaper Engine & Lively Wallpaper

An ethereal, interactive 3D koi pond designed as a living desktop wallpaper. Powered by procedural animation, hydrodynamic wave physics, dynamic caustics, diurnal weather presets, and realistic fish biomechanics with zero video loops.

[![Vitest](https://img.shields.io/badge/Vitest-78%2F78%20Passing-brightgreen.svg)]()
[![Three.js](https://img.shields.io/badge/Three.js-r186-blue.svg)]()
[![Wallpaper Engine](https://img.shields.io/badge/Wallpaper%20Engine-Compatible-orange.svg)]()
[![Lively Wallpaper](https://img.shields.io/badge/Lively%20Wallpaper-Compatible-cyan.svg)]()

---

## 🚀 Quick Installation Guide

### Option 1: Lively Wallpaper (Free & Open Source)

#### Step 1: Install Wallpaper
- **Method A (Drag & Drop Package)**:
  1. Download [`NagomiKoi.livelypack`](./NagomiKoi.livelypack) from the repository root.
  2. Open **Lively Wallpaper**.
  3. Simply **drag and drop** `NagomiKoi.livelypack` directly into the Lively window, or click **Add Wallpaper (+)** ➔ **Browse** ➔ select `NagomiKoi.livelypack`.
  4. Click **OK** to set it as your active desktop wallpaper!
- **Method B (Local Developer Sync)**:
  - Double-click [`Sync-Lively-Wallpaper.bat`](./Sync-Lively-Wallpaper.bat) or run `npm run sync:lively`. This compiles the project and links it directly into your active Lively library.

#### Step 2: Customizing Settings in Lively
1. In Lively Wallpaper, find **Nagomi Koi** in your library.
2. Click the three dots `...` (or right-click) ➔ Select **Customise Wallpaper**.
3. All properties are organized logically with instant real-time preview:
   - **Weather Preset**: Choose between *Sunny*, *Sunset*, *Moonlight*, *Rain*, *Overcast*, *Mist*, or *Deep Clear*.
   - **Apple Liquid Glass Clock**: Toggle on/off, choose *Submerged* (underwater refraction beneath fish) or *Floating* (crisp surface HUD), switch between *24-Hour* and *12-Hour (AM/PM)*, toggle seconds counter, and adjust opacity.
   - **Interactive Actions**: Click **Scatter Koi** to trigger a ripple panic wave, or **Reset Pond** to re-seed school mutations.
   - **Ambient River Audio**: Check the audio toggle to listen to a soothing natural stream loop.
   - **Performance / FPS Cap**: Select *60 FPS*, *45 FPS*, or *30 FPS* to save laptop battery and GPU cycles.
   - **13 Mythic Mutations**: Fine-tune metamorphosis probabilities or toggle specific mutations (Astraeus, Serene, Umbra, Aurora, Midas, Frozen, etc.).
4. Hover over any property title to view detailed **help tooltips** explaining what each setting does!

#### Step 3: Lively Wallpaper Tips & Best Practices
- **Mouse Interaction**: Make sure **Lively Settings ➔ Wallpaper ➔ Input ➔ Mouse Interaction** is set to *Enabled* to interact with water ripples, glide lotus leaves, and feed koi.
- **Audio Playback**: If audio is silent after checking *Ambient River Audio*, ensure **Lively Settings ➔ Audio ➔ Volume** is turned up.
- **Auto-Pause while Gaming**: Lively Wallpaper automatically pauses GPU rendering to 0% usage whenever a game or full-screen app is running.

---

### Option 2: Wallpaper Engine (Steam)
#### Automatic 1-Click Install:
1. Double-click [`Sync-Wallpaper-Engine.bat`](./Sync-Wallpaper-Engine.bat) in the repository root.
2. The script will automatically compile the application and link it directly to your Wallpaper Engine project directory:
   `C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\projects\myprojects\nagomi_koi`
3. Open Wallpaper Engine and select **Interactive Koi Pond**!

#### Manual Installation:
1. Clone or download this repository.
2. Run `npm install && npm run build`.
3. Copy the contents of the `dist/` folder along with `project.json` and `preview.png` into:
   `C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\projects\myprojects\nagomi_koi\`
4. Launch Wallpaper Engine.

---

### Option 3: Synchronize Both Wallpapers Simultaneously
If you have both Wallpaper Engine and Lively Wallpaper installed:
- Double-click [`Sync-All-Wallpapers.bat`](./Sync-All-Wallpapers.bat) or run:
  ```bash
  npm run sync:all
  ```
- Both wallpaper directories and packages will be built and updated in a single operation!

---

## ✨ Features & Customization

### 🕒 Translucent Liquid Pond Clock
- **3 Display Modes**:
  - `Submerged`: Sits underwater with authentic fluid refraction and caustic light streams flowing across the digits.
  - `Floating`: A luminous surface aquatic HUD resting gently on the water with organic wave buoyancy.
  - `Off (Disabled)`: Completely disables the clock mesh with **0 draw calls**.
- **Full Customization**:
  - Time Formats: `24-Hour` or `12-Hour (AM/PM)`.
  - Toggle seconds display.
  - Opacity slider (10% to 100%).
  - 4 Screen Positions: *Center of Pond*, *Top Right*, *Top Left*, *Bottom Center*.

### 🐟 Biomechanical Koi Locomotion
- **Physiologically Accurate Spine Kinematics**:
  - Implements a cephalocaudal vertebral stiffness gradient (rigid skull and thoracic cavity, smoothly transitioning to flexible caudal swimming blades).
  - Strict cumulative body curvature clamp ($\le 52.7^\circ$) eliminates unnatural U-shape bending or mesh pinching during sharp turns.
- **Natural Behaviors**: Gliding, coasting, hovering, schooling, scatter impulses, and feeding gulps.
- **Tactile Obstacle Avoidance**: Living fish tactfully detour around stationary frozen fish ice blocks.

### 🧬 13 Rare Metamorphic Mutations
Watch koi periodically metamorphose into mythical and legendary variants:
- **Astraeus** (Mythic): Deep cosmic indigo body with radiant starlight celestial halos.
- **Serene** (Rare): Bioluminescent jade-green glow with gentle fluid water ripples.
- **Umbra** (Mythic): Void silhouette crowned with a 360-degree rotating solar eclipse corona.
- **Aurora** (Legendary): Shimmering polar borealis gradient.
- **Midas** (Legendary): Luminous 24k molten gold scales.
- **Frozen** (Rare): Encased within an icy crystalline block that gently floats on the water.
- **Electric**, **Nuclear**, **Mythical**, **Rainbow Cluster**, **Ishmael**, **Crimson**, and **Bunny**.
- *Control Panel:* Toggle any specific mutation on/off, adjust mutation metamorphosis rate (0–100%), or trigger instant transformations.

### 🌤️ 7 Dynamic Weather Presets
- **Sunny**: Crisp crystalline daylight with sharp water caustics.
- **Sunset**: Warm dusk amber glow with lengthened shadows.
- **Moonlight**: Ethereal nighttime bioluminescence.
- **Rain**: Atmospheric rain ripples and cooling water tones.
- **Overcast**: Soft diffused cloud cover.
- **Mist**: Atmospheric morning fog.
- **Deep Clear**: Vibrant cyan tropical lagoon.

### ⚡ 0% CPU/GPU Background Suspension
- **Smart Power Saving**: Automatically pauses rendering when full-screen 3D games or applications are active, or when the desktop is hidden, preserving 100% of your system's gaming performance.
- **FPS Limiter Options**: Native (Uncapped), 60 FPS, 45 FPS, and 30 FPS.
- Optional ambient river water audio stream with mute toggles.

---

## 🛠️ Development & Building from Source

```bash
# Install dependencies
npm install

# Start local development server (with live reload)
npm run dev

# Run automated test suite (74 unit tests)
npm run test

# Build production bundle
npm run build

# Sync to Wallpaper Engine & Lively Wallpaper
npm run sync:all
```

---

## 📜 License
MIT License. Inspired by procedural aquatic simulations.
