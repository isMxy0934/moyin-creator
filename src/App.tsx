// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { useEffect } from "react";
import { Layout } from "@/components/Layout";
import { Toaster } from "@/components/ui/sonner";
import { useThemeStore } from "@/stores/theme-store";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { parseApiKeys } from "@/lib/api-key-manager";

function App() {
  const { theme } = useThemeStore();

  // 启动时自动同步所有已配置 API Key 的供应商模型元数据
  useEffect(() => {
    const { providers, syncProviderModels } = useAPIConfigStore.getState();
    for (const p of providers) {
      if (parseApiKeys(p.apiKey).length > 0) {
        syncProviderModels(p.id).then(result => {
          if (result.success) {
            console.log(`[App] Auto-synced ${p.name}: ${result.count} models`);
          }
        });
      }
    }
  }, []);

  // 同步主题到 html 元素
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  return (
    <div className="h-screen w-screen overflow-hidden">
      <Layout />
      <Toaster richColors position="top-center" />
    </div>
  );
}

export default App;
