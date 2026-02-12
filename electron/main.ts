// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app, BrowserWindow, ipcMain, protocol, dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import os from 'node:os'

type HttpProxyRequest = {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

type HttpProxyResponse = {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  error?: string
}

// electron-vite 构建后的目录结构
//
// ├─┬ out
// │ ├─┬ main
// │ │ └── index.cjs
// │ ├─┬ preload
// │ │ └── index.cjs
// │ └─┬ renderer
// │   └── index.html
//
process.env.APP_ROOT = path.join(__dirname, '../..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(__dirname)
export const RENDERER_DIST = path.join(__dirname, '../renderer')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

const USER_DATA_DIRNAME = 'MUMU'
const LEGACY_USER_DATA_DIRNAME = '魔因漫创'

function ensureBrandedUserDataPath() {
  try {
    const appDataPath = app.getPath('appData')
    const targetUserDataPath = path.join(appDataPath, USER_DATA_DIRNAME)
    const legacyUserDataPath = path.join(appDataPath, LEGACY_USER_DATA_DIRNAME)
    const currentUserDataPath = app.getPath('userData')

    if (currentUserDataPath !== targetUserDataPath) {
      app.setPath('userData', targetUserDataPath)
    }

    const targetHasData = fs.existsSync(targetUserDataPath)
      && fs.readdirSync(targetUserDataPath).length > 0

    if (!targetHasData && fs.existsSync(legacyUserDataPath)) {
      fs.mkdirSync(targetUserDataPath, { recursive: true })
      fs.cpSync(legacyUserDataPath, targetUserDataPath, {
        recursive: true,
        force: false,
        errorOnExist: false,
      })
      console.log('[UserData] Migrated legacy userData from 魔因漫创 to MUMU')
    }
  } catch (error) {
    console.warn('[UserData] Failed to normalize userData path:', error)
  }
}

ensureBrandedUserDataPath()

async function canReachUrl(rawUrl: string, timeoutMs = 1500): Promise<boolean> {
  return await new Promise((resolve) => {
    try {
      const target = new URL(rawUrl)
      const client = target.protocol === 'https:' ? https : http
      const req = client.get(rawUrl, (res) => {
        res.resume()
        resolve(true)
      })
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('timeout'))
        resolve(false)
      })
      req.on('error', () => resolve(false))
    } catch {
      resolve(false)
    }
  })
}

async function resolveRendererEntry():
  Promise<{ mode: 'url'; target: string } | { mode: 'file' } | { mode: 'error'; message: string }> {
  if (app.isPackaged) {
    return { mode: 'file' }
  }

  const candidates = [
    VITE_DEV_SERVER_URL,
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://localhost:5173',
    'http://localhost:5174',
  ].filter((u): u is string => Boolean(u))

  for (const url of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await canReachUrl(url)) {
      return { mode: 'url', target: url }
    }
  }

  return {
    mode: 'error',
    message: `开发模式未检测到可用渲染服务。\n候选地址: ${candidates.join(', ') || '无'}\n请确认 npm run dev 的 Vite 服务已启动。`,
  }
}

function createWindow() {
  win = new BrowserWindow({
    title: 'MUMU',
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    console.log('[Electron] did-finish-load:', win?.webContents.getURL())
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })
  win.webContents.on('did-start-loading', () => {
    console.log('[Electron] did-start-loading')
  })
  win.webContents.on('did-stop-loading', () => {
    console.log('[Electron] did-stop-loading')
  })
  win.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
    console.error('[Electron] did-fail-load:', { code, description, validatedURL })
  })
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer:${level}] ${sourceId}:${line} ${message}`)
  })

  // Open external links in system browser instead of inside Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    // Allow navigating to the app itself (dev server or local file)
    if (VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL)) return
    if (url.startsWith('file://')) return
    // Block and open externally
    event.preventDefault()
    shell.openExternal(url)
  })

  console.log('[Electron] app.isPackaged=', app.isPackaged, 'VITE_DEV_SERVER_URL=', VITE_DEV_SERVER_URL || '(empty)')
  void (async () => {
    const entry = await resolveRendererEntry()
    if (entry.mode === 'url') {
      console.log('[Electron] Loading renderer URL:', entry.target)
      await win?.loadURL(entry.target)
      return
    }
    if (entry.mode === 'file') {
      const filePath = path.join(RENDERER_DIST, 'index.html')
      console.log('[Electron] Loading renderer file:', filePath)
      await win?.loadFile(filePath)
      return
    }
    const html = `
      <html><body style="font-family:-apple-system,Segoe UI,sans-serif;padding:24px;background:#111;color:#eee;">
      <h2>Renderer Failed To Start</h2>
      <pre style="white-space:pre-wrap;line-height:1.5;">${entry.message}</pre>
      </body></html>
    `
    await win?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  })().catch((err) => {
    console.error('[Electron] Failed to load renderer entry:', err)
  })
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
// ==================== Storage Config ====================
type StorageConfig = {
  // Single base path for all data (projects + media)
  basePath?: string
  // Legacy fields (for migration)
  projectPath?: string
  mediaPath?: string
  autoCleanEnabled?: boolean
  autoCleanDays?: number
}

const DEFAULT_STORAGE_CONFIG: Required<StorageConfig> = {
  basePath: '',
  projectPath: '',
  mediaPath: '',
  autoCleanEnabled: false,
  autoCleanDays: 30,
}

const storageConfigPath = path.join(app.getPath('userData'), 'storage-config.json')
let storageConfig: StorageConfig = loadStorageConfig()
let autoCleanInterval: NodeJS.Timeout | null = null

function shouldCleanOnStartup(): boolean {
  return !app.isPackaged && process.argv.includes('--clean')
}

function loadStorageConfig(): StorageConfig {
  try {
    if (fs.existsSync(storageConfigPath)) {
      const raw = fs.readFileSync(storageConfigPath, 'utf-8')
      const parsed = JSON.parse(raw) as StorageConfig
      return { ...DEFAULT_STORAGE_CONFIG, ...parsed }
    }
  } catch (error) {
    console.warn('Failed to load storage config:', error)
  }
  return { ...DEFAULT_STORAGE_CONFIG }
}

function saveStorageConfig() {
  try {
    fs.writeFileSync(storageConfigPath, JSON.stringify(storageConfig, null, 2), 'utf-8')
  } catch (error) {
    console.warn('Failed to save storage config:', error)
  }
}

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function normalizePath(inputPath: string) {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(inputPath)
}

// Check if childPath is inside parentPath (subdirectory)
function isSubdirectory(parentPath: string, childPath: string): boolean {
  const normalizedParent = path.resolve(parentPath).toLowerCase() + path.sep
  const normalizedChild = path.resolve(childPath).toLowerCase() + path.sep
  return normalizedChild.startsWith(normalizedParent)
}

// Check if two paths are the same or one contains the other
function pathsConflict(source: string, dest: string): string | null {
  const normalizedSource = path.resolve(source).toLowerCase()
  const normalizedDest = path.resolve(dest).toLowerCase()
  
  if (normalizedSource === normalizedDest) {
    return null // Same path is OK, handled elsewhere
  }
  if (isSubdirectory(source, dest)) {
    return '目标路径不能是当前路径的子目录'
  }
  if (isSubdirectory(dest, source)) {
    return '当前路径不能是目标路径的子目录'
  }
  return null
}

// Get the base storage path (contains both projects and media)
function getStorageBasePath() {
  // Check new basePath first, then fall back to legacy projectPath parent
  const configured = storageConfig.basePath?.trim()
  if (configured) {
    return normalizePath(configured)
  }
  // Legacy migration: if projectPath exists, use its parent
  const legacyProject = storageConfig.projectPath?.trim()
  if (legacyProject) {
    return path.dirname(normalizePath(legacyProject))
  }
  return app.getPath('userData')
}

function getProjectDataRoot() {
  const base = path.join(getStorageBasePath(), 'projects')
  ensureDir(base)
  return base
}

function getMediaRoot() {
  const base = path.join(getStorageBasePath(), 'media')
  ensureDir(base)
  return base
}

function getCacheDirs() {
  const userData = app.getPath('userData')
  return [
    path.join(userData, 'Cache'),
    path.join(userData, 'Code Cache'),
    path.join(userData, 'GPUCache'),
  ]
}

async function getDirectorySize(dirPath: string): Promise<number> {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    let total = 0
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        total += await getDirectorySize(fullPath)
      } else {
        const stat = await fs.promises.stat(fullPath)
        total += stat.size
      }
    }
    return total
  } catch {
    return 0
  }
}

async function copyDir(source: string, destination: string) {
  ensureDir(destination)
  await fs.promises.cp(source, destination, { recursive: true, force: true })
}

async function removeDir(dirPath: string) {
  await fs.promises.rm(dirPath, { recursive: true, force: true })
}

async function moveDir(source: string, destination: string) {
  if (source === destination) return
  await copyDir(source, destination)
  await removeDir(source)
}

async function deleteOldFiles(dirPath: string, cutoffTime: number): Promise<number> {
  let cleared = 0
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        cleared += await deleteOldFiles(fullPath, cutoffTime)
        const remaining = await fs.promises.readdir(fullPath)
        if (remaining.length === 0) {
          await fs.promises.rmdir(fullPath).catch(() => {})
        }
      } else {
        const stat = await fs.promises.stat(fullPath)
        if (stat.mtimeMs < cutoffTime) {
          await fs.promises.unlink(fullPath).catch(() => {})
          cleared += stat.size
        }
      }
    }
  } catch {
    // ignore
  }
  return cleared
}

function scheduleAutoClean() {
  if (autoCleanInterval) {
    clearInterval(autoCleanInterval)
    autoCleanInterval = null
  }
  if (storageConfig.autoCleanEnabled) {
    const days = storageConfig.autoCleanDays || DEFAULT_STORAGE_CONFIG.autoCleanDays
    clearCache(days).catch(() => {})
    autoCleanInterval = setInterval(() => {
      clearCache(days).catch(() => {})
    }, 24 * 60 * 60 * 1000)
  }
}

async function clearCache(olderThanDays?: number): Promise<number> {
  const dirs = getCacheDirs()
  let cleared = 0
  if (olderThanDays && olderThanDays > 0) {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
    for (const dir of dirs) {
      cleared += await deleteOldFiles(dir, cutoff)
    }
    return cleared
  }
  for (const dir of dirs) {
    cleared += await getDirectorySize(dir)
    await removeDir(dir).catch(() => {})
    ensureDir(dir)
  }
  return cleared
}

async function clearAllDataForDevStartup() {
  const userData = app.getPath('userData')
  const basePath = getStorageBasePath()
  const dirsToRemove = new Set<string>([
    path.join(basePath, 'projects'),
    path.join(basePath, 'media'),
    ...getCacheDirs(),
  ])

  const legacyProject = storageConfig.projectPath?.trim()
  if (legacyProject) dirsToRemove.add(normalizePath(legacyProject))
  const legacyMedia = storageConfig.mediaPath?.trim()
  if (legacyMedia) dirsToRemove.add(normalizePath(legacyMedia))

  for (const dir of dirsToRemove) {
    await removeDir(dir).catch(() => {})
  }

  await removeDir(path.join(userData, 'IndexedDB')).catch(() => {})
  await removeDir(path.join(userData, 'Local Storage')).catch(() => {})
  await removeDir(path.join(userData, 'Session Storage')).catch(() => {})
  await removeDir(path.join(userData, 'blob_storage')).catch(() => {})

  storageConfig = { ...DEFAULT_STORAGE_CONFIG }
  try {
    if (fs.existsSync(storageConfigPath)) fs.unlinkSync(storageConfigPath)
  } catch (error) {
    console.warn('Failed to remove storage config:', error)
  }

  console.log('[DevClean] Cleared app data, caches, and storage config.')
}

// Get user data path for storing images
const getImagesDir = (subDir: string) => {
  const imagesDir = path.join(getMediaRoot(), subDir)
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true })
  }
  return imagesDir
}

// Download image from URL and save to local file
const downloadImage = (url: string, filePath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(filePath)
    
    protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location
        if (redirectUrl) {
          downloadImage(redirectUrl, filePath).then(resolve).catch(reject)
          return
        }
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`))
        return
      }
      
      response.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve()
      })
    }).on('error', (err) => {
      fs.unlink(filePath, () => {}) // Delete partial file
      reject(err)
    })
  })
}

// IPC handlers for image management
ipcMain.handle('save-image', async (_event, { url, category, filename }) => {
  try {
    const imagesDir = getImagesDir(category)
    const ext = path.extname(filename) || '.png'
    const safeName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`
    const filePath = path.join(imagesDir, safeName)
    
    // data: URL — 直接解码 base64 写入文件（canvas 切割产物）
    if (url.startsWith('data:')) {
      const matches = url.match(/^data:[^;]+;base64,(.+)$/s)
      if (!matches) {
        return { success: false, error: 'Invalid data URL format' }
      }
      const buffer = Buffer.from(matches[1], 'base64')
      if (buffer.length === 0) {
        return { success: false, error: 'Decoded base64 data is empty (0 bytes)' }
      }
      fs.writeFileSync(filePath, buffer)
    } else {
      await downloadImage(url, filePath)
    }
    
    // Validate file was written successfully with non-zero size
    const stat = fs.statSync(filePath)
    if (stat.size === 0) {
      fs.unlinkSync(filePath) // Clean up empty file
      return { success: false, error: 'Saved file is 0 bytes' }
    }
    
    // Return local path that can be used in the app
    return { success: true, localPath: `local-image://${category}/${safeName}` }
  } catch (error) {
    console.error('Failed to save image:', error)
    return { success: false, error: String(error) }
  }
})

// Proxy HTTP requests in main process to bypass renderer CORS limits
ipcMain.handle('http-proxy-fetch', async (_event, payload: HttpProxyRequest): Promise<HttpProxyResponse> => {
  try {
    const target = new URL(payload.url)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return {
        ok: false,
        status: 0,
        statusText: 'Invalid protocol',
        headers: {},
        body: '',
        error: 'Only http/https URLs are allowed',
      }
    }

    const response = await fetch(payload.url, {
      method: payload.method || 'GET',
      headers: payload.headers,
      body: payload.body,
    })

    const text = await response.text()
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers,
      body: text,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: 'Network Error',
      headers: {},
      body: '',
      error: error instanceof Error ? error.message : String(error),
    }
  }
})

ipcMain.handle('get-image-path', async (_event, localPath: string) => {
  // Convert local-image://category/filename to actual file path
  const match = localPath.match(/^local-image:\/\/(.+)\/(.+)$/)
  if (!match) return null
  
  const [, category, filename] = match
  const filePath = path.join(getMediaRoot(), category, filename)
  
  if (fs.existsSync(filePath)) {
    // Windows: file:///H:/path/to/file.png (三斜杠 + 正斜杠)
    return `file:///${filePath.replace(/\\/g, '/')}`
  }
  return null
})

ipcMain.handle('delete-image', async (_event, localPath: string) => {
  const match = localPath.match(/^local-image:\/\/(.+)\/(.+)$/)
  if (!match) return false
  
  const [, category, filename] = match
  const filePath = path.join(getMediaRoot(), category, filename)
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return true
  } catch {
    return false
  }
})

// Read local image as base64 (for AI API calls)
ipcMain.handle('read-image-base64', async (_event, localPath: string) => {
  try {
    let filePath: string
    
    // Handle local-image:// protocol
    const match = localPath.match(/^local-image:\/\/(.+)\/(.+)$/)
    if (match) {
      const [, category, filename] = match
      filePath = path.join(getMediaRoot(), category, decodeURIComponent(filename))
    } else if (localPath.startsWith('file://')) {
      filePath = localPath.replace('file://', '')
    } else {
      filePath = localPath
    }
    
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' }
    }
    
    const data = fs.readFileSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    }
    const mimeType = mimeTypes[ext] || 'image/png'
    const base64 = `data:${mimeType};base64,${data.toString('base64')}`
    
    return { success: true, base64, mimeType, size: data.length }
  } catch (error) {
    console.error('Failed to read image:', error)
    return { success: false, error: String(error) }
  }
})

// Get absolute file path for a local-image:// URL
ipcMain.handle('get-absolute-path', async (_event, localPath: string) => {
  const match = localPath.match(/^local-image:\/\/(.+)\/(.+)$/)
  if (!match) return null
  
  const [, category, filename] = match
  const filePath = path.join(getMediaRoot(), category, decodeURIComponent(filename))
  
  if (fs.existsSync(filePath)) {
    return filePath
  }
  return null
})

// ==================== File Storage for App Data ====================
const getDataDir = () => {
  const dataDir = getProjectDataRoot()
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  return dataDir
}

ipcMain.handle('file-storage-get', async (_event, key: string) => {
  try {
    const filePath = path.join(getDataDir(), `${key}.json`)
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8')
      return data
    }
    return null
  } catch (error) {
    console.error('Failed to read file storage:', error)
    return null
  }
})

ipcMain.handle('file-storage-set', async (_event, key: string, value: string) => {
  try {
    const filePath = path.join(getDataDir(), `${key}.json`)
    // Ensure parent directory exists (supports nested keys like _p/xxx/script)
    const parentDir = path.dirname(filePath)
    ensureDir(parentDir)
    fs.writeFileSync(filePath, value, 'utf-8')
    console.log(`Saved to file: ${filePath} (${Math.round(value.length / 1024)}KB)`)
    return true
  } catch (error) {
    console.error('Failed to write file storage:', error)
    return false
  }
})

ipcMain.handle('file-storage-remove', async (_event, key: string) => {
  try {
    const filePath = path.join(getDataDir(), `${key}.json`)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return true
  } catch (error) {
    console.error('Failed to remove file storage:', error)
    return false
  }
})

// Check if a storage key exists
ipcMain.handle('file-storage-exists', async (_event, key: string) => {
  try {
    const filePath = path.join(getDataDir(), `${key}.json`)
    return fs.existsSync(filePath)
  } catch {
    return false
  }
})

// List all JSON keys under a directory prefix
ipcMain.handle('file-storage-list', async (_event, prefix: string) => {
  try {
    const dirPath = path.join(getDataDir(), prefix)
    if (!fs.existsSync(dirPath)) return []
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    return entries
      .filter(e => e.isFile() && e.name.endsWith('.json'))
      .map(e => `${prefix}/${e.name.replace('.json', '')}`)
  } catch {
    return []
  }
})

// Remove an entire directory (for project deletion)
ipcMain.handle('file-storage-remove-dir', async (_event, prefix: string) => {
  try {
    const dirPath = path.join(getDataDir(), prefix)
    if (fs.existsSync(dirPath)) {
      await fs.promises.rm(dirPath, { recursive: true, force: true })
    }
    return true
  } catch (error) {
    console.error('Failed to remove directory:', error)
    return false
  }
})
// ==================== Storage Manager ====================
ipcMain.handle('storage-get-paths', async () => {
  return {
    basePath: getStorageBasePath(),
    projectPath: getProjectDataRoot(),
    mediaPath: getMediaRoot(),
    cachePath: path.join(app.getPath('userData'), 'Cache'),
  }
})

ipcMain.handle('storage-select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

// Validate if a directory contains valid data (projects/ subfolder with .json files or _p/ dirs)
ipcMain.handle('storage-validate-data-dir', async (_event, dirPath: string) => {
  try {
    if (!dirPath) return { valid: false, error: '路径不能为空' }
    const target = normalizePath(dirPath)
    if (!fs.existsSync(target)) return { valid: false, error: '目录不存在' }
    
    // Check for projects/ subfolder with .json files or _p/ per-project dirs
    const projectsDir = path.join(target, 'projects')
    const mediaDir = path.join(target, 'media')
    
    let projectCount = 0
    let mediaCount = 0
    
    if (fs.existsSync(projectsDir)) {
      const files = await fs.promises.readdir(projectsDir)
      // Count root .json files (global stores)
      projectCount = files.filter(f => f.endsWith('.json')).length
      // Also count per-project directories under _p/
      const perProjectDir = path.join(projectsDir, '_p')
      if (fs.existsSync(perProjectDir)) {
        const projectDirs = await fs.promises.readdir(perProjectDir, { withFileTypes: true })
        const dirCount = projectDirs.filter(d => d.isDirectory() && !d.name.startsWith('.')).length
        if (dirCount > 0) projectCount = Math.max(projectCount, dirCount)
      }
    }
    
    if (fs.existsSync(mediaDir)) {
      const entries = await fs.promises.readdir(mediaDir)
      mediaCount = entries.length
    }
    
    if (projectCount === 0 && mediaCount === 0) {
      return { valid: false, error: '该目录不包含有效的数据（需要 projects/ 或 media/ 子目录）' }
    }
    
    return { valid: true, projectCount, mediaCount }
  } catch (error) {
    return { valid: false, error: String(error) }
  }
})

// Link to existing data directory (no data movement)
ipcMain.handle('storage-link-data', async (_event, dirPath: string) => {
  try {
    if (!dirPath) return { success: false, error: '路径不能为空' }
    const target = normalizePath(dirPath)
    if (!fs.existsSync(target)) return { success: false, error: '目录不存在' }
    
    // Validate it has data
    const projectsDir = path.join(target, 'projects')
    const mediaDir = path.join(target, 'media')
    
    const hasProjects = fs.existsSync(projectsDir)
    const hasMedia = fs.existsSync(mediaDir)
    
    if (!hasProjects && !hasMedia) {
      return { success: false, error: '该目录不包含有效的数据（需要 projects/ 或 media/ 子目录）' }
    }
    
    // Update config to point to this directory
    storageConfig.basePath = target
    storageConfig.projectPath = '' // Clear legacy
    storageConfig.mediaPath = ''   // Clear legacy
    saveStorageConfig()
    return { success: true, path: target }
  } catch (error) {
    console.error('Failed to link data:', error)
    return { success: false, error: String(error) }
  }
})

// Move all data to new location (single operation)
ipcMain.handle('storage-move-data', async (_event, newPath: string) => {
  try {
    if (!newPath) return { success: false, error: '路径不能为空' }
    const target = normalizePath(newPath)
    const currentBase = getStorageBasePath()
    
    if (currentBase === target) return { success: true, path: currentBase }
    
    // Check for path conflicts
    const conflictError = pathsConflict(currentBase, target)
    if (conflictError) {
      return { success: false, error: conflictError }
    }
    
    // Ensure target directories exist
    const targetProjectsDir = path.join(target, 'projects')
    const targetMediaDir = path.join(target, 'media')
    ensureDir(targetProjectsDir)
    ensureDir(targetMediaDir)
    
    // Move projects
    const currentProjectsDir = getProjectDataRoot()
    if (fs.existsSync(currentProjectsDir)) {
      const files = await fs.promises.readdir(currentProjectsDir)
      for (const file of files) {
        const src = path.join(currentProjectsDir, file)
        const dest = path.join(targetProjectsDir, file)
        await fs.promises.cp(src, dest, { recursive: true, force: true })
      }
    }
    
    // Move media
    const currentMediaDir = getMediaRoot()
    if (fs.existsSync(currentMediaDir)) {
      const files = await fs.promises.readdir(currentMediaDir)
      for (const file of files) {
        const src = path.join(currentMediaDir, file)
        const dest = path.join(targetMediaDir, file)
        await fs.promises.cp(src, dest, { recursive: true, force: true })
      }
    }
    
    // Update config
    storageConfig.basePath = target
    storageConfig.projectPath = '' // Clear legacy
    storageConfig.mediaPath = ''   // Clear legacy
    saveStorageConfig()
    
    // Clean up old directories (only if different from userData)
    const userData = app.getPath('userData')
    if (!currentProjectsDir.startsWith(userData)) {
      await removeDir(currentProjectsDir).catch(() => {})
    }
    if (!currentMediaDir.startsWith(userData)) {
      await removeDir(currentMediaDir).catch(() => {})
    }
    
    return { success: true, path: target }
  } catch (error) {
    console.error('Failed to move data:', error)
    return { success: false, error: String(error) }
  }
})

// Export all data
ipcMain.handle('storage-export-data', async (_event, targetPath: string) => {
  try {
    if (!targetPath) return { success: false, error: '路径不能为空' }
    const exportDir = path.join(
      normalizePath(targetPath),
      `mumu-data-${new Date().toISOString().replace(/[:.]/g, '-')}`
    )
    
    // Create export structure
    const exportProjectsDir = path.join(exportDir, 'projects')
    const exportMediaDir = path.join(exportDir, 'media')
    ensureDir(exportProjectsDir)
    ensureDir(exportMediaDir)
    
    // Copy projects
    await copyDir(getProjectDataRoot(), exportProjectsDir)
    // Copy media
    await copyDir(getMediaRoot(), exportMediaDir)
    
    return { success: true, path: exportDir }
  } catch (error) {
    console.error('Failed to export data:', error)
    return { success: false, error: String(error) }
  }
})

// Import all data (with backup for safety)
ipcMain.handle('storage-import-data', async (_event, sourcePath: string) => {
  try {
    if (!sourcePath) return { success: false, error: '路径不能为空' }
    const source = normalizePath(sourcePath)
    
    const sourceProjectsDir = path.join(source, 'projects')
    const sourceMediaDir = path.join(source, 'media')
    
    // Validate source has data
    const hasProjects = fs.existsSync(sourceProjectsDir)
    const hasMedia = fs.existsSync(sourceMediaDir)
    if (!hasProjects && !hasMedia) {
      return { success: false, error: '源目录不包含有效数据（需要 projects/ 或 media/ 子目录）' }
    }
    
    // Create temporary backup for rollback
    const backupDir = path.join(os.tmpdir(), `mumu-backup-${Date.now()}`)
    const currentProjectsDir = getProjectDataRoot()
    const currentMediaDir = getMediaRoot()
    
    try {
      // Backup existing data
      if (hasProjects && fs.existsSync(currentProjectsDir)) {
        const files = await fs.promises.readdir(currentProjectsDir)
        if (files.length > 0) {
          await copyDir(currentProjectsDir, path.join(backupDir, 'projects'))
        }
      }
      if (hasMedia && fs.existsSync(currentMediaDir)) {
        const files = await fs.promises.readdir(currentMediaDir)
        if (files.length > 0) {
          await copyDir(currentMediaDir, path.join(backupDir, 'media'))
        }
      }
      
      // Import new data
      if (hasProjects) {
        await removeDir(currentProjectsDir).catch(() => {})
        await copyDir(sourceProjectsDir, currentProjectsDir)
      }
      if (hasMedia) {
        await removeDir(currentMediaDir).catch(() => {})
        await copyDir(sourceMediaDir, currentMediaDir)
      }
      
      // Clear migration flag so migration re-evaluates imported data on next startup
      const migrationFlagPath = path.join(currentProjectsDir, '_p', '_migrated.json')
      if (fs.existsSync(migrationFlagPath)) {
        fs.unlinkSync(migrationFlagPath)
        console.log('Cleared migration flag for re-evaluation after import')
      }
      
      // Success - clean up backup
      await removeDir(backupDir).catch(() => {})
      return { success: true }
    } catch (importError) {
      // Rollback: restore from backup
      console.error('Import failed, rolling back:', importError)
      const backupProjectsDir = path.join(backupDir, 'projects')
      const backupMediaDir = path.join(backupDir, 'media')
      
      if (fs.existsSync(backupProjectsDir)) {
        await removeDir(currentProjectsDir).catch(() => {})
        await copyDir(backupProjectsDir, currentProjectsDir).catch(() => {})
      }
      if (fs.existsSync(backupMediaDir)) {
        await removeDir(currentMediaDir).catch(() => {})
        await copyDir(backupMediaDir, currentMediaDir).catch(() => {})
      }
      await removeDir(backupDir).catch(() => {})
      
      throw importError
    }
  } catch (error) {
    console.error('Failed to import data:', error)
    return { success: false, error: String(error) }
  }
})

// Legacy handlers (kept for backward compatibility but redirect to new ones)
ipcMain.handle('storage-validate-project-dir', async (_event, dirPath: string) => {
  // Redirect to new unified handler
  return ipcMain.emit('storage-validate-data-dir', null, dirPath)
})

ipcMain.handle('storage-link-project-data', async (_event, dirPath: string) => {
  // For legacy: assume dirPath is the projects folder, use parent as base
  const target = normalizePath(dirPath)
  const basePath = path.dirname(target)
  storageConfig.basePath = basePath
  storageConfig.projectPath = ''
  storageConfig.mediaPath = ''
  saveStorageConfig()
  return { success: true, path: basePath }
})

ipcMain.handle('storage-link-media-data', async (_event, dirPath: string) => {
  // For legacy: assume dirPath is the media folder, use parent as base
  const target = normalizePath(dirPath)
  const basePath = path.dirname(target)
  storageConfig.basePath = basePath
  storageConfig.projectPath = ''
  storageConfig.mediaPath = ''
  saveStorageConfig()
  return { success: true, path: basePath }
})

ipcMain.handle('storage-move-project-data', async (_event, _newPath: string) => {
  return { success: false, error: '请使用新的统一存储路径功能' }
})

ipcMain.handle('storage-move-media-data', async (_event, _newPath: string) => {
  return { success: false, error: '请使用新的统一存储路径功能' }
})

ipcMain.handle('storage-export-project-data', async (_event, targetPath: string) => {
  // Redirect to unified export
  try {
    if (!targetPath) return { success: false, error: '路径不能为空' }
    const exportDir = path.join(
      normalizePath(targetPath),
      `mumu-data-${new Date().toISOString().replace(/[:.]/g, '-')}`
    )
    ensureDir(path.join(exportDir, 'projects'))
    ensureDir(path.join(exportDir, 'media'))
    await copyDir(getProjectDataRoot(), path.join(exportDir, 'projects'))
    await copyDir(getMediaRoot(), path.join(exportDir, 'media'))
    return { success: true, path: exportDir }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('storage-import-project-data', async (_event, sourcePath: string) => {
  // Redirect to unified import
  try {
    if (!sourcePath) return { success: false, error: '路径不能为空' }
    const source = normalizePath(sourcePath)
    const projectsDir = path.join(source, 'projects')
    const mediaDir = path.join(source, 'media')
    
    if (fs.existsSync(projectsDir)) {
      await removeDir(getProjectDataRoot()).catch(() => {})
      await copyDir(projectsDir, getProjectDataRoot())
    } else {
      // Legacy: source is the projects folder itself
      await removeDir(getProjectDataRoot()).catch(() => {})
      await copyDir(source, getProjectDataRoot())
    }
    
    if (fs.existsSync(mediaDir)) {
      await removeDir(getMediaRoot()).catch(() => {})
      await copyDir(mediaDir, getMediaRoot())
    }
    
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('storage-export-media-data', async (_event, targetPath: string) => {
  // Legacy: redirect to unified export
  try {
    if (!targetPath) return { success: false, error: '路径不能为空' }
    const exportDir = path.join(
      normalizePath(targetPath),
      `mumu-data-${new Date().toISOString().replace(/[:.]/g, '-')}`
    )
    ensureDir(path.join(exportDir, 'projects'))
    ensureDir(path.join(exportDir, 'media'))
    await copyDir(getProjectDataRoot(), path.join(exportDir, 'projects'))
    await copyDir(getMediaRoot(), path.join(exportDir, 'media'))
    return { success: true, path: exportDir }
  } catch (error) {
    console.error('Failed to export data:', error)
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('storage-import-media-data', async (_event, sourcePath: string) => {
  try {
    if (!sourcePath) return { success: false, error: '路径不能为空' }
    const target = getMediaRoot()
    const source = normalizePath(sourcePath)
    if (source === target) return { success: true }
    await removeDir(target)
    await copyDir(source, target)
    return { success: true }
  } catch (error) {
    console.error('Failed to import media data:', error)
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('storage-get-cache-size', async () => {
  const dirs = getCacheDirs()
  const details = await Promise.all(
    dirs.map(async (dirPath) => ({
      path: dirPath,
      size: await getDirectorySize(dirPath),
    }))
  )
  const total = details.reduce((sum, item) => sum + item.size, 0)
  return { total, details }
})

ipcMain.handle('storage-clear-cache', async (_event, options?: { olderThanDays?: number }) => {
  try {
    const clearedBytes = await clearCache(options?.olderThanDays)
    return { success: true, clearedBytes }
  } catch (error) {
    console.error('Failed to clear cache:', error)
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('storage-update-config', async (_event, config: { autoCleanEnabled?: boolean; autoCleanDays?: number }) => {
  storageConfig = { ...storageConfig, ...config }
  saveStorageConfig()
  scheduleAutoClean()
  return true
})

// ==================== File Export (Save Dialog) ====================
ipcMain.handle('save-file-dialog', async (_event, { localPath, defaultPath, filters }: { localPath: string, defaultPath: string, filters: { name: string, extensions: string[] }[] }) => {
  try {
    // Resolve the source file path
    let sourcePath: string | null = null
    
    // Handle local-image:// and local-video:// protocols
    const imageMatch = localPath.match(/^local-image:\/\/(.+)\/(.+)$/)
    const videoMatch = localPath.match(/^local-video:\/\/(.+)\/(.+)$/)
    
    if (imageMatch) {
      const [, category, filename] = imageMatch
      sourcePath = path.join(getMediaRoot(), category, decodeURIComponent(filename))
    } else if (videoMatch) {
      const [, category, filename] = videoMatch
      sourcePath = path.join(getMediaRoot(), category, decodeURIComponent(filename))
    } else if (localPath.startsWith('file://')) {
      sourcePath = localPath.replace('file://', '')
    } else {
      sourcePath = localPath
    }
    
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { success: false, error: 'Source file not found' }
    }
    
    // Show save dialog
    const result = await dialog.showSaveDialog({
      defaultPath: defaultPath,
      filters: filters,
    })
    
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }
    
    // Copy file to destination
    fs.copyFileSync(sourcePath, result.filePath)
    
    return { success: true, filePath: result.filePath }
  } catch (error) {
    console.error('Failed to save file:', error)
    return { success: false, error: String(error) }
  }
})

// ==================== Demo Project Seed ====================

/**
 * Get the path to bundled demo-data.
 * - Dev mode: {APP_ROOT}/demo-data/
 * - Production: {resourcesPath}/demo-data/
 */
function getDemoDataPath(): string {
  if (!app.isPackaged) {
    const appRoot = process.env.APP_ROOT || path.join(__dirname, '../..')
    return path.join(appRoot, 'demo-data')
  }
  return path.join(process.resourcesPath, 'demo-data')
}

/**
 * Recursively copy a directory.
 * Uses fs.cpSync which is available in Node 16.7+.
 */
function copyDirSync(src: string, dest: string) {
  fs.cpSync(src, dest, { recursive: true, force: false, errorOnExist: false })
}

/**
 * Seed demo project exactly once.
 * Default behavior: demo is included on first startup.
 * If the user later deletes the demo project, we do NOT auto-add it back.
 */
function seedDemoProject() {
  const projectDataRoot = getProjectDataRoot()
  const seedMarkerPath = path.join(projectDataRoot, '_meta', 'demo-seeded.json')
  const projectStoreCandidates = ['mumu-project-store.json', 'moyin-project-store.json']
  const characterStoreCandidates = ['mumu-character-library.json', 'moyin-character-library.json']

  const getFirstExistingPath = (baseDir: string, names: string[]): string | null => {
    for (const name of names) {
      const fullPath = path.join(baseDir, name)
      if (fs.existsSync(fullPath)) return fullPath
    }
    return null
  }

  const writeCompatProjectStores = (payload: string) => {
    for (const name of projectStoreCandidates) {
      fs.writeFileSync(path.join(projectDataRoot, name), payload, 'utf-8')
    }
  }

  const ensureCharacterStoreCompatibility = (sourceRoot: string) => {
    const sourcePath = getFirstExistingPath(sourceRoot, characterStoreCandidates)
    if (!sourcePath) return
    for (const name of characterStoreCandidates) {
      const targetPath = path.join(projectDataRoot, name)
      if (!fs.existsSync(targetPath)) {
        fs.copyFileSync(sourcePath, targetPath)
      }
    }
  }

  const writeSeedMarker = () => {
    ensureDir(path.dirname(seedMarkerPath))
    fs.writeFileSync(
      seedMarkerPath,
      JSON.stringify({ seededAt: new Date().toISOString(), version: 1 }, null, 2),
      'utf-8'
    )
  }

  if (fs.existsSync(seedMarkerPath)) {
    return
  }

  const demoPath = getDemoDataPath()
  const demoProjects = path.join(demoPath, 'projects')
  const demoMedia = path.join(demoPath, 'media')

  if (!fs.existsSync(demoProjects)) {
    console.warn('[Seed] Demo data not found at:', demoPath)
    return
  }

  const demoProjectStorePath = getFirstExistingPath(demoProjects, projectStoreCandidates)
  if (!demoProjectStorePath) {
    console.warn('[Seed] Demo project store file not found:', demoProjects)
    return
  }

  try {
    type ProjectEntry = {
      id: string
      [key: string]: unknown
    }
    type ProjectIndexState = {
      projects?: ProjectEntry[]
      activeProjectId?: string | null
      [key: string]: unknown
    }
    type ProjectIndexStore = {
      state?: ProjectIndexState
      version?: number
    } & ProjectIndexState

    const demoStoreRaw = fs.readFileSync(demoProjectStorePath, 'utf-8')
    const demoStore = JSON.parse(demoStoreRaw) as ProjectIndexStore
    const demoState = (demoStore.state || demoStore) as ProjectIndexState
    const demoProjectList = Array.isArray(demoState.projects) ? demoState.projects : []

    const currentStorePath = getFirstExistingPath(projectDataRoot, projectStoreCandidates)
    let currentStore: ProjectIndexStore = { state: { projects: [], activeProjectId: null }, version: 0 }
    if (currentStorePath) {
      currentStore = JSON.parse(fs.readFileSync(currentStorePath, 'utf-8')) as ProjectIndexStore
    }
    const currentState = (currentStore.state || currentStore) as ProjectIndexState
    const currentProjects = Array.isArray(currentState.projects) ? currentState.projects : []
    const seenIds = new Set<string>(currentProjects.map((p) => p.id))
    let addedCount = 0

    for (const demoProject of demoProjectList) {
      if (!seenIds.has(demoProject.id)) {
        currentProjects.push(demoProject)
        seenIds.add(demoProject.id)
        addedCount++
      }
    }

    const mergedStore = {
      state: {
        ...currentState,
        projects: currentProjects,
        activeProjectId: currentState.activeProjectId || demoState.activeProjectId || currentProjects[0]?.id || null,
      },
      version: typeof currentStore.version === 'number' ? currentStore.version : (demoStore.version ?? 0),
    }
    writeCompatProjectStores(JSON.stringify(mergedStore))
    ensureCharacterStoreCompatibility(demoProjects)

    // Copy per-project and shared demo data if missing
    for (const demoProject of demoProjectList) {
      const srcProjectDir = path.join(demoProjects, '_p', demoProject.id)
      const dstProjectDir = path.join(projectDataRoot, '_p', demoProject.id)
      if (fs.existsSync(srcProjectDir) && !fs.existsSync(dstProjectDir)) {
        copyDirSync(srcProjectDir, dstProjectDir)
      }
    }

    const demoSharedDir = path.join(demoProjects, '_shared')
    const targetSharedDir = path.join(projectDataRoot, '_shared')
    if (fs.existsSync(demoSharedDir)) {
      ensureDir(targetSharedDir)
      for (const name of fs.readdirSync(demoSharedDir)) {
        const src = path.join(demoSharedDir, name)
        const dst = path.join(targetSharedDir, name)
        if (!fs.existsSync(dst)) fs.copyFileSync(src, dst)
      }
    }

    // Copy media files
    if (fs.existsSync(demoMedia)) {
      const mediaRoot = getMediaRoot()
      copyDirSync(demoMedia, mediaRoot)
      console.log('[Seed] Copied media files to:', mediaRoot)
    }

    writeSeedMarker()
    console.log(`[Seed] Demo project ensured successfully. Added ${addedCount} project(s).`)
  } catch (error) {
    console.error('[Seed] Failed to seed demo project:', error)
  }
}

// Register custom protocol for local images
protocol.registerSchemesAsPrivileged([{
  scheme: 'local-image',
  privileges: {
    secure: true,
    supportFetchAPI: true,
    bypassCSP: true,
    stream: true,
  }
}])

app.whenReady().then(async () => {
  if (shouldCleanOnStartup()) {
    await clearAllDataForDevStartup()
  }

  // Seed demo project on first run (before window creation)
  seedDemoProject()

  scheduleAutoClean()
  // Handle local-image:// protocol
  protocol.handle('local-image', async (request) => {
    try {
      // URL format: local-image://category/filename
      const url = new URL(request.url)
      const category = url.hostname
      const filename = decodeURIComponent(url.pathname.slice(1)) // Remove leading / and decode
      const filePath = path.join(getMediaRoot(), category, filename)
      
      // Read file directly
      const data = fs.readFileSync(filePath)
      
      // Determine MIME type based on extension
      const ext = path.extname(filename).toLowerCase()
      const mimeTypes: Record<string, string> = {
        // Images
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        // Videos
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
      }
      const mimeType = mimeTypes[ext] || 'application/octet-stream'
      
      return new Response(data, {
        headers: { 'Content-Type': mimeType }
      })
    } catch (error) {
      console.error('Failed to load local image:', error)
      return new Response('Image not found', { status: 404 })
    }
  })
  
  createWindow()
})
