import type { RouteRecordRaw } from 'vue-router'

/**
 * 页面组件注册表
 *
 * 使用 Vite 的 import.meta.glob 收集 src/views 下的全部页面，
 * 生成「componentKey -> 懒加载组件」的映射。
 *
 * 约定：componentKey 与文件路径一致，例如：
 *   dashboard/index  ->  src/views/dashboard/index.vue
 *   topics/my        ->  src/views/topics/my.vue
 *
 * 注意：动态业务页面必须放在 src/views 下，
 * 因为 src/pages 会被 vue-router 自动路由插件提前生成为静态路由。
 */
const viewModules = import.meta.glob('/src/views/**/*.vue')

/** 兜底组件：componentKey 找不到对应文件时渲染，避免整页白屏 */
const MissingView = () => import('@/views/_shared/missing-view.vue')

export type ViewComponentLoader = NonNullable<RouteRecordRaw['component']>

export function resolveViewComponent(componentKey?: string | null): ViewComponentLoader {
  if (!componentKey) return MissingView as ViewComponentLoader

  const normalized = componentKey.replace(/^\/+/, '').replace(/\.vue$/, '')
  const modulePath = `/src/views/${normalized}.vue`
  const loader = viewModules[modulePath]

  if (!loader) {
    console.warn(`[router] 未找到页面组件 ${modulePath}，请检查菜单的 componentKey 配置是否正确`)
    return MissingView as ViewComponentLoader
  }

  return loader as ViewComponentLoader
}

/** 判断某个 componentKey 是否已在注册表中登记 */
export function hasViewComponent(componentKey: string): boolean {
  const normalized = componentKey.replace(/^\/+/, '').replace(/\.vue$/, '')
  return Boolean(viewModules[`/src/views/${normalized}.vue`])
}
