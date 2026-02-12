#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-console */
const fs = require('node:fs')
const path = require('node:path')

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    const value = argv[i + 1]
    args[key.slice(2)] = value
    i += 1
  }
  return args
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

async function waitForComposer(page, timeoutMs, log) {
  const selectors = [
    'textarea[aria-label*="prompt" i]',
    'textarea[placeholder*="message" i]',
    'div[contenteditable="true"][aria-label*="prompt" i]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea',
    'div[contenteditable="true"]',
  ]
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first()
      const count = await locator.count()
      if (count === 0) continue
      const visible = await locator.isVisible().catch(() => false)
      if (!visible) continue
      log(`Composer found with selector: ${selector}`)
      return locator
    }
    await sleep(1000)
  }
  throw new Error('未找到 Gemini 输入框。请先登录 Gemini 并保持页面可交互。')
}

async function fillComposer(composer, prompt) {
  await composer.click({ timeout: 10_000 })
  try {
    await composer.fill(prompt, { timeout: 10_000 })
    return
  } catch {
    // fallback to keyboard typing
  }
  await composer.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await composer.press('Backspace')
  await composer.type(prompt, { delay: 8 })
}

async function tryAttachFile(page, filePath, log) {
  const directInput = page.locator('input[type="file"]').first()
  if (await directInput.count()) {
    await directInput.setInputFiles(filePath)
    log('Attached file through direct input[type=file]')
    return true
  }

  const buttonNames = [
    /upload/i,
    /add files?/i,
    /add photo/i,
    /attach/i,
    /上传/i,
    /添加/i,
  ]

  for (const namePattern of buttonNames) {
    const button = page.getByRole('button', { name: namePattern }).first()
    if (!(await button.count())) continue
    const visible = await button.isVisible().catch(() => false)
    if (!visible) continue
    await button.click().catch(() => {})
    await sleep(500)
    const input = page.locator('input[type="file"]').first()
    if (await input.count()) {
      await input.setInputFiles(filePath)
      log(`Attached file by clicking button pattern ${String(namePattern)}`)
      return true
    }
  }

  log('No upload input found for first frame attachment; continue without upload')
  return false
}

async function getMediaCount(page, mediaType) {
  return await page.evaluate((type) => {
    if (type === 'video') {
      return document.querySelectorAll('video').length + document.querySelectorAll('video source').length
    }
    return document.querySelectorAll('img').length
  }, mediaType)
}

async function findLatestMediaUrl(page, mediaType) {
  return await page.evaluate((type) => {
    if (type === 'video') {
      const videos = Array.from(document.querySelectorAll('video'))
      const sources = Array.from(document.querySelectorAll('video source'))
      const urls = []
      for (const source of sources) {
        if (source.src) urls.push(source.src)
      }
      for (const video of videos) {
        const src = video.currentSrc || video.src
        if (src) urls.push(src)
      }
      return urls.length > 0 ? urls[urls.length - 1] : null
    }

    const imgs = Array.from(document.querySelectorAll('img'))
      .map((img) => ({
        src: img.currentSrc || img.src || '',
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
      }))
      .filter((img) => img.src)

    const filtered = imgs.filter((img) => {
      if (img.src.startsWith('data:image/')) return true
      if (img.src.startsWith('blob:')) return true
      return img.width >= 256 || img.height >= 256
    })

    return filtered.length > 0 ? filtered[filtered.length - 1].src : null
  }, mediaType)
}

async function fetchAsDataUrl(page, sourceUrl) {
  if (!sourceUrl) return null
  if (sourceUrl.startsWith('data:')) return sourceUrl

  return await page.evaluate(async (url) => {
    const response = await fetch(url)
    const blob = await response.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('Failed to read blob'))
      reader.readAsDataURL(blob)
    })
  }, sourceUrl)
}

async function waitForMedia(page, mediaType, baselineCount, timeoutMs, log) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const currentCount = await getMediaCount(page, mediaType)
    const latest = await findLatestMediaUrl(page, mediaType)
    if (latest && currentCount >= baselineCount) {
      log(`Detected media candidate (${mediaType}) count=${currentCount}`)
      return latest
    }
    await sleep(2000)
  }
  throw new Error(`等待 Gemini ${mediaType === 'video' ? '视频' : '图片'} 结果超时`)
}

async function run() {
  const args = parseArgs(process.argv)
  const inputPath = args.input
  const outputPath = args.output
  if (!inputPath || !outputPath) {
    throw new Error('Missing --input or --output')
  }

  const inputRaw = fs.readFileSync(inputPath, 'utf-8')
  const input = JSON.parse(inputRaw)
  const logLines = []
  const log = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`
    logLines.push(line)
    console.log(line)
  }

  const writeOutput = (payload) => {
    const finalPayload = {
      ...payload,
      logs: logLines.join('\n'),
    }
    fs.writeFileSync(outputPath, JSON.stringify(finalPayload, null, 2), 'utf-8')
    if (input.logPath) {
      fs.writeFileSync(input.logPath, finalPayload.logs || '', 'utf-8')
    }
  }

  ensureDir(path.dirname(outputPath))
  if (input.profileDir) {
    ensureDir(input.profileDir)
  }

  let context
  try {
    const { chromium } = require('playwright')
    context = await chromium.launchPersistentContext(input.profileDir, {
      headless: false,
      viewport: { width: 1440, height: 960 },
      args: ['--start-maximized'],
    })
    const page = context.pages()[0] || (await context.newPage())
    page.setDefaultTimeout(30_000)

    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})

    const composer = await waitForComposer(page, 120_000, log)

    let prompt = String(input.prompt || '').trim()
    if (input.mediaType === 'image') {
      prompt = `${prompt}\n\nGenerate exactly one high-quality image in aspect ratio ${input.aspectRatio || '16:9'}.`
    } else {
      prompt = `${prompt}\n\nGenerate a short video in aspect ratio ${input.aspectRatio || '16:9'}.`
    }

    if (input.referenceImagePath && fs.existsSync(input.referenceImagePath)) {
      await tryAttachFile(page, input.referenceImagePath, log)
      prompt = `${prompt}\nUse the uploaded image as a strict visual reference for subject identity and composition.`
    }

    if (input.mediaType === 'video' && input.firstFramePath && fs.existsSync(input.firstFramePath)) {
      await tryAttachFile(page, input.firstFramePath, log)
      prompt = `${prompt}\nUse the uploaded image as the first frame.`
    }

    const baselineCount = await getMediaCount(page, input.mediaType)
    await fillComposer(composer, prompt)
    await composer.press('Enter')
    log(`Prompt submitted for ${input.mediaType}`)

    const sourceUrl = await waitForMedia(
      page,
      input.mediaType,
      baselineCount,
      Number(input.timeoutMs || 360_000),
      log,
    )
    const dataUrl = await fetchAsDataUrl(page, sourceUrl)
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      throw new Error('未能提取可用的媒体数据（data URL）')
    }

    const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/)
    const mimeType = mimeMatch ? mimeMatch[1] : (input.mediaType === 'video' ? 'video/mp4' : 'image/png')
    writeOutput({
      success: true,
      dataUrl,
      mimeType,
      sourceUrl,
    })
  } catch (error) {
    writeOutput({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })
    process.exitCode = 1
  } finally {
    if (context) {
      await context.close().catch(() => {})
    }
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
