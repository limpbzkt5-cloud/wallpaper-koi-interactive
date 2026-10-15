import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function findWallpaperEngine() {
  // 1. Try detecting currently running process
  try {
    const runningPath = execSync(
      'powershell -NoProfile -Command "(Get-Process -Name wallpaper64, wallpaper32 -ErrorAction SilentlyContinue | Select-Object -First 1).Path"',
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();

    if (runningPath && fs.existsSync(runningPath)) {
      return {
        exePath: runningPath,
        dirPath: path.dirname(runningPath),
        isRunning: true,
      };
    }
  } catch {
    // Ignore error
  }

  // 2. Try registry lookup for Steam
  const candidates = [];
  try {
    const regOutput = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = regOutput.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (match && match[1]) {
      const steamPath = match[1].trim();
      candidates.push(path.join(steamPath, 'steamapps', 'common', 'wallpaper_engine'));
    }
  } catch {
    // Ignore error
  }

  // 3. Fallback common drive paths
  candidates.push(
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine',
    'C:\\Program Files\\Steam\\steamapps\\common\\wallpaper_engine',
    'D:\\Steam\\steamapps\\common\\wallpaper_engine',
    'D:\\SteamLibrary\\steamapps\\common\\wallpaper_engine',
    'E:\\Steam\\steamapps\\common\\wallpaper_engine',
    'E:\\SteamLibrary\\steamapps\\common\\wallpaper_engine'
  );

  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      const exe64 = path.join(dir, 'wallpaper64.exe');
      const exe32 = path.join(dir, 'wallpaper32.exe');
      const exePath = fs.existsSync(exe64) ? exe64 : fs.existsSync(exe32) ? exe32 : null;
      return {
        exePath,
        dirPath: dir,
        isRunning: false,
      };
    }
  }

  return null;
}

function syncWE() {
  const distDir = path.resolve('dist');
  if (!fs.existsSync(distDir)) {
    console.error('Error: dist/ directory not found. Please run "npm run build" first.');
    process.exit(1);
  }

  const weInfo = findWallpaperEngine();
  if (!weInfo || !weInfo.dirPath) {
    console.warn('\n[!] Wallpaper Engine installation not found on this system.');
    console.log('    Build output is ready in dist/ directory.\n');
    return;
  }

  const projectDir = path.join(weInfo.dirPath, 'projects', 'myprojects', 'nagomi_koi');
  fs.mkdirSync(projectDir, { recursive: true });

  console.log(`Syncing dist/ to Wallpaper Engine: ${projectDir}...`);
  fs.cpSync(distDir, projectDir, { recursive: true, force: true });
  console.log('✓ Files copied successfully.');

  if (weInfo.isRunning && weInfo.exePath) {
    console.log('Reloading Wallpaper Engine...');
    try {
      execSync(`"${weInfo.exePath}" -control reloadWallpaper`, { stdio: 'ignore' });
      const indexPath = path.join(projectDir, 'index.html');
      execSync(`"${weInfo.exePath}" -control openWallpaper -file "${indexPath}"`, { stdio: 'ignore' });
      console.log('✓ Wallpaper Engine reloaded.');
    } catch (err) {
      console.warn('Could not trigger reload in Wallpaper Engine:', err.message);
    }
  } else {
    console.log('Notice: Wallpaper Engine is not currently running. Launch it to view the updated wallpaper.');
  }

  console.log('Wallpaper Engine synced successfully!\n');
}

syncWE();
