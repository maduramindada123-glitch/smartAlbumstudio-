import { app, BrowserWindow, dialog, ipcMain, protocol, net, nativeTheme, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import exifr from 'exifr';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

let mainWindow;
let cacheDirectory;

const SUPPORTED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.heic', '.heif', '.webp'
]);

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function friendlyError(error) {
  const message = String(error?.message || error || 'Unknown error');
  if (/unsupported|input file contains unsupported image format/i.test(message)) {
    return 'This image format is not supported by the installed image decoder.';
  }
  if (/enoent|no such file/i.test(message)) return 'The original photo could not be found.';
  if (/enospc|no space left/i.test(message)) return 'Your Mac is low on disk space. Free some space and try again.';
  if (/memory|alloc|out of memory/i.test(message)) return 'Your Mac ran out of memory while preparing this photo.';
  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
}

async function ensureCache() {
  cacheDirectory = path.join(app.getPath('userData'), 'photo-cache');
  await fs.mkdir(cacheDirectory, { recursive: true });
}

async function listImages(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listImages(fullPath));
    } else if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

async function processPhoto(filePath) {
  const id = randomUUID();
  const thumbnailName = `${id}-thumb.jpg`;
  const previewName = `${id}-preview.jpg`;
  const thumbnailPath = path.join(cacheDirectory, thumbnailName);
  const previewPath = path.join(cacheDirectory, previewName);

  const metadata = await sharp(filePath, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('The file does not contain a readable image.');
  const exif = await exifr.parse(filePath, {
    pick: ['DateTimeOriginal', 'CreateDate', 'Make', 'Model', 'Orientation']
  }).catch(() => null);

  await Promise.all([
    sharp(filePath, { failOn: 'none' })
      .rotate()
      .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(thumbnailPath),
    sharp(filePath, { failOn: 'none' })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(previewPath)
  ]);

  const date = exif?.DateTimeOriginal || exif?.CreateDate || null;
  const orientation = metadata.width === metadata.height ? 'square' :
    (metadata.width > metadata.height ? 'landscape' : 'portrait');

  return {
    id,
    name: path.basename(filePath),
    path: filePath,
    width: metadata.width,
    height: metadata.height,
    orientation,
    capturedAt: date instanceof Date ? date.toISOString() : null,
    camera: [exif?.Make, exif?.Model].filter(Boolean).join(' ') || null,
    thumbnailUrl: `app-asset://cache/${thumbnailName}`,
    previewUrl: `app-asset://cache/${previewName}`,
    status: 'ready'
  };
}

async function importPaths(paths) {
  const files = [];
  for (const item of paths) {
    try {
      const stat = await fs.stat(item);
      if (stat.isDirectory()) files.push(...await listImages(item));
      else if (SUPPORTED_EXTENSIONS.has(path.extname(item).toLowerCase())) files.push(item);
    } catch (error) {
      send('import:error', { file: item, message: friendlyError(error) });
    }
  }

  const uniqueFiles = [...new Set(files)];
  send('import:started', { total: uniqueFiles.length });
  let completed = 0;
  let next = 0;
  const workerCount = Math.min(3, Math.max(1, uniqueFiles.length));

  const workers = Array.from({ length: workerCount }, async () => {
    while (next < uniqueFiles.length) {
      const index = next++;
      const file = uniqueFiles[index];
      try {
        const photo = await processPhoto(file);
        send('import:photo', photo);
      } catch (error) {
        send('import:error', { file, message: friendlyError(error) });
      } finally {
        completed += 1;
        send('import:progress', { completed, total: uniqueFiles.length });
      }
    }
  });

  await Promise.all(workers);
  send('import:finished', { total: uniqueFiles.length });
  return { total: uniqueFiles.length };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'SmartAlbum Studio',
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0D0D0F' : '#F4F5F7',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.loadFile(path.join(app.getAppPath(), 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

app.whenReady().then(async () => {
  await ensureCache();

  protocol.handle('app-asset', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'cache') return new Response('Not found', { status: 404 });
      const filename = path.basename(decodeURIComponent(url.pathname));
      if (!filename || filename === '.' || filename === '..') return new Response('Not found', { status: 404 });
      const assetPath = path.join(cacheDirectory, filename);
      return await net.fetch(pathToFileURL(assetPath).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  ipcMain.handle('photos:choose-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import photos',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'heic', 'heif', 'webp'] }]
    });
    if (result.canceled) return { canceled: true };
    return importPaths(result.filePaths);
  });

  ipcMain.handle('photos:choose-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import photo folder',
      properties: ['openDirectory']
    });
    if (result.canceled) return { canceled: true };
    return importPaths(result.filePaths);
  });

  ipcMain.handle('app:system-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  ipcMain.handle('app:reveal-cache', async () => shell.showItemInFolder(cacheDirectory));

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
