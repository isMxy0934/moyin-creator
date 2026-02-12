// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { installTestModeFetchInterceptor } from '@/lib/ai/test-mode-fetch'
import { seedDemoForBrowserMode } from '@/lib/demo/browser-demo-seed'

installTestModeFetchInterceptor()
seedDemoForBrowserMode()

async function bootstrap() {
  const { default: App } = await import('./App.tsx')
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void bootstrap()

// Use contextBridge (Electron only)
if (window.ipcRenderer?.on) {
  window.ipcRenderer.on('main-process-message', (_event, message) => {
    console.log(message)
  })
}
