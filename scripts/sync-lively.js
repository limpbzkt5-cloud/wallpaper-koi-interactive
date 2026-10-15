import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function findLivelyDir() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;

  const candidates = [
    path.join(
      localAppData,
      'Packages',
      '12030rocksdanister.LivelyWallpaper_97hta09mmv6hy',
      'LocalCache',
      'Local',
      'Lively Wallpaper',
      'Library',
      'wallpapers',
      'nagomi_koi_pond'
    ),
    path.join(
      localAppData,
      'Lively Wallpaper',
      'Library',
      'wallpapers',
      'nagomi_koi_pond'
    ),
  ];

  for (const dir of candidates) {
    const parent = path.dirname(dir);
    if (fs.existsSync(parent)) {
      return dir;
    }
  }
  return null;
}

function syncLively() {
  const distDir = path.resolve('dist');
  if (!fs.existsSync(distDir)) {
    console.error('Error: dist/ directory not found. Please run "npm run build" first.');
    process.exit(1);
  }

  // 1. Copy to lively wallpaper folder if lively library exists
  const livelyDir = findLivelyDir();
  if (livelyDir) {
    console.log(`Syncing dist/ to Lively Wallpaper: ${livelyDir}...`);
    fs.mkdirSync(livelyDir, { recursive: true });
    fs.cpSync(distDir, livelyDir, { recursive: true, force: true });
    console.log('✓ Files copied to Lively Wallpaper.');
  } else {
    console.log('Notice: Lively Wallpaper installation not found. Skipping folder sync.');
  }

  // 2. Create NagomiKoi.livelypack
  console.log('Packaging NagomiKoi.livelypack...');
  try {
    const zipPath = path.resolve('NagomiKoi.zip');
    const packPath = path.resolve('NagomiKoi.livelypack');

    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    if (fs.existsSync(packPath)) fs.unlinkSync(packPath);

    // Use PowerShell Compress-Archive for standard zip without extra npm dependencies
    execSync(
      'powershell -NoProfile -Command "Compress-Archive -Path \'dist\\*\' -DestinationPath \'NagomiKoi.zip\' -Force; Move-Item -Path \'NagomiKoi.zip\' -Destination \'NagomiKoi.livelypack\' -Force"',
      { stdio: 'inherit' }
    );

    console.log('✓ NagomiKoi.livelypack created successfully.');
  } catch (err) {
    console.warn('Could not create NagomiKoi.livelypack:', err.message);
  }

  console.log('Lively Wallpaper synced and NagomiKoi.livelypack updated successfully!\n');
}

syncLively();
