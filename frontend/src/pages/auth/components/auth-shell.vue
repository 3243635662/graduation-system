<script setup lang="ts">
import LanguageChange from '@/components/language-change.vue'
import { GraduationCapIcon, MoonIcon, ShieldCheckIcon, SunIcon } from '@lucide/vue'
import { useColorMode } from '@vueuse/core'
import type { Component } from 'vue'
import { computed, nextTick } from 'vue'

interface FeatureItem {
  icon: Component
  title: string
  subtitle?: string
}

const props = withDefaults(
  defineProps<{
    backgroundImage: string
    heroTitle?: string
    heroHighlight?: string
    heroTagline?: string
    features?: FeatureItem[]
    securityNotice?: string
  }>(),
  {
    heroTitle: 'Build a Better',
    heroHighlight: 'Future Together',
    heroTagline: 'Innovative · Professional · Efficient',
    securityNotice: 'Your data is secure with us · 高校毕业设计综合管理平台',
    features: () => [],
  },
)

const mode = useColorMode()

/**
 * 背景图多尺寸 WebP 候选集。
 * 约定：原图 campus-lake.png 旁边放 campus-lake-800/1280/1672.webp，
 * 由 backgroundImage 推导，页面侧无需改动传参。
 * 原图宽 1672px 已是最大尺寸，因此 1672 封顶，不做无意义的放大档。
 */
const BG_WIDTHS = [800, 1280, 1672] as const

const bgSrcset = computed(() => {
  const base = props.backgroundImage.replace(/\.(png|jpe?g)$/i, '')
  return BG_WIDTHS.map((w) => `${base}-${w}.webp ${w}w`).join(', ')
})

/**
 * 圆形扩散揭幕动画切换日夜模式
 *
 * 使用 View Transition API 渲染新旧两帧快照，新主题以圆形 clip-path 向外扩散揭幕。
 * 两个方向沿对角线往复，形成"右上 → 左下 / 左下 → 右上"的交替观感：
 * - 亮 → 暗：暗色从右上角按钮位置向外扩散，铺向左下
 * - 暗 → 亮：亮色从左下角向外扩散，回到右上
 * 对不支持 View Transition 的浏览器自动降级为直接切换。
 */
function resolveRevealCenter(target: 'light' | 'dark', anchor: HTMLElement | null) {
  if (target === 'dark' && anchor) {
    const rect = anchor.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }
  // 左下角
  return { x: 0, y: window.innerHeight }
}

async function toggleTheme(event: MouseEvent) {
  const newMode = mode.value === 'dark' ? 'light' : 'dark'

  // 不支持 View Transition 时降级
  if (
    !document.startViewTransition ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    mode.value = newMode
    return
  }

  const anchor = event.currentTarget as HTMLElement | null
  const { x, y } = resolveRevealCenter(newMode, anchor)

  // 以扩散圆心到视口最远角的距离作为最终半径，确保完全覆盖
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  )

  const transition = document.startViewTransition(async () => {
    mode.value = newMode
    await nextTick()
  })

  await transition.ready

  // 新主题画面从圆心向外圆形扩散展开
  document.documentElement.animate(
    {
      clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
    },
    {
      duration: 700,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      pseudoElement: '::view-transition-new(root)',
    },
  )
}
</script>

<template>
  <!-- 固定全屏，绝对禁止页面滚动条，保持单屏完整呈现 -->
  <div
    class="fixed inset-0 h-screen w-screen overflow-hidden flex flex-col justify-between bg-background text-foreground selection:bg-primary selection:text-primary-foreground"
  >
    <!-- 背景图片与蒙层：白天完全不加蒙层，保留照片原貌；仅夜间压暗 -->
    <div class="absolute inset-0 -z-10 overflow-hidden pointer-events-none bg-background">
      <img
        :src="backgroundImage"
        :srcset="bgSrcset"
        sizes="max(100vw, 178vh)"
        alt="Campus background"
        decoding="async"
        fetchpriority="high"
        class="auth-bg-img w-full h-full object-cover object-center brightness-100 contrast-[1.02] dark:brightness-[0.86] dark:contrast-[1.06] dark:saturate-[1.06]"
      />

      <!-- 夜间蒙层：仅在 dark 下生效，颜色仍取自主题变量 -->
      <div
        class="auth-overlay absolute inset-0 opacity-0 dark:opacity-100 bg-linear-to-b from-background/46 via-background/33 to-background/42"
      />
      <!-- 夜间主色晕染：让 6 套主题在夜间彼此可区分 -->
      <div
        class="auth-overlay absolute inset-0 opacity-0 dark:opacity-100 bg-linear-to-tr from-primary/8 via-transparent to-primary/5"
      />
    </div>

    <!-- 顶栏 -->
    <header
      class="w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-12 pt-5 pb-2 flex items-center justify-between relative z-20 shrink-0"
    >
      <router-link
        to="/"
        class="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
      >
        <div
          class="w-9 h-9 rounded-xl glass-surface flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
        >
          <GraduationCapIcon class="w-5 h-5 text-primary" />
        </div>
        <div class="flex flex-col text-media-foreground drop-shadow-md">
          <span class="text-base font-bold tracking-tight leading-tight">Graduation</span>
          <span
            class="text-[10px] font-normal text-media-foreground/80 tracking-wider uppercase leading-tight"
            >Management System</span
          >
        </div>
      </router-link>

      <div class="flex items-center gap-2 auth-toolbar">
        <LanguageChange />

        <!-- 自定义日夜切换按钮：圆形扩散揭幕动画 -->
        <button
          type="button"
          class="auth-theme-toggle"
          :aria-label="mode === 'dark' ? '切换为日间模式' : '切换为夜间模式'"
          :title="mode === 'dark' ? '切换为日间模式' : '切换为夜间模式'"
          @click="toggleTheme"
        >
          <SunIcon
            class="w-4 h-4 rotate-0 scale-100 transition-transform duration-500 dark:-rotate-90 dark:scale-0 absolute"
          />
          <MoonIcon
            class="w-4 h-4 rotate-90 scale-0 transition-transform duration-500 dark:rotate-0 dark:scale-100 absolute"
          />
        </button>
      </div>
    </header>

    <!-- 中间核心区 -->
    <main
      class="w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-12 py-2 flex-1 flex items-center min-h-0 relative z-20"
    >
      <div class="w-full grid lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        <!-- 左侧文案与 3 个玻璃特性卡 -->
        <section class="lg:col-span-7 flex flex-col justify-center py-2">
          <div class="space-y-3 sm:space-y-4">
            <h1
              class="auth-rise text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-[1.12] text-media-foreground drop-shadow-lg"
            >
              <span>{{ heroTitle }}</span>
              <span
                class="auth-sheen block mt-1 sm:mt-1.5 italic font-serif font-semibold bg-linear-to-r from-media-foreground via-media-foreground to-primary bg-clip-text text-transparent"
              >
                {{ heroHighlight }}
              </span>
            </h1>

            <div
              class="auth-rise auth-delay-1 flex items-center gap-3 text-media-foreground/80 text-xs sm:text-sm font-medium tracking-wide drop-shadow-md"
            >
              <span class="w-6 h-[2px] bg-media-foreground/80 rounded-full" />
              <span>{{ heroTagline }}</span>
            </div>
          </div>

          <!-- 底部 3 块水岸浮动玻璃拟态特性卡 -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-8 lg:mt-12">
            <div
              v-for="(item, idx) in features"
              :key="idx"
              class="auth-feature-card group p-3 flex items-center gap-2.5"
              :style="{ animationDelay: `${260 + idx * 90}ms` }"
            >
              <div class="auth-feature-icon shrink-0">
                <component :is="item.icon" class="w-4 h-4" />
              </div>
              <div class="flex flex-col min-w-0">
                <span class="text-xs font-semibold tracking-wide truncate">{{ item.title }}</span>
                <span v-if="item.subtitle" class="text-[10px] opacity-70 truncate mt-0.5">{{
                  item.subtitle
                }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 右侧表单卡片插槽 -->
        <section class="auth-rise auth-delay-2 lg:col-span-5 flex justify-center lg:justify-end">
          <slot />
        </section>
      </div>
    </main>

    <!-- 底栏 -->
    <footer
      class="w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-12 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-media-foreground/85 relative z-20 shrink-0 drop-shadow-md"
    >
      <div class="flex items-center gap-1.5">
        <ShieldCheckIcon class="w-3.5 h-3.5 text-media-foreground shrink-0" />
        <span class="text-[11px] sm:text-xs">{{ securityNotice }}</span>
      </div>

      <div class="flex items-center gap-3 text-[11px] sm:text-xs">
        <span class="hover:text-media-foreground transition-colors cursor-pointer"
          >Terms of Service</span
        >
        <span>|</span>
        <span class="hover:text-media-foreground transition-colors cursor-pointer"
          >Privacy Policy</span
        >
        <span>|</span>
        <span class="hover:text-media-foreground transition-colors cursor-pointer">Help</span>
      </div>
    </footer>
  </div>
</template>

<!--
  View Transition API 的伪元素必须在全局作用域下声明，
  scoped 样式无法选中 ::view-transition-* 伪元素。
-->
<style>
::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
  mix-blend-mode: normal;
}

::view-transition-new(root) {
  z-index: 9999;
}

::view-transition-old(root) {
  z-index: 1;
}
</style>

<style scoped>
/*
 * 认证页工具栏按钮统一样式。
 * 颜色全部由主题变量混合得出（--card / --border / --ring / --foreground），
 * 因此 6 套主题 × 明暗模式都会自动跟随，无需 dark: 单独覆盖。
 */
.auth-toolbar :deep(button),
.auth-theme-toggle {
  border: 1px solid color-mix(in oklab, var(--border) 55%, transparent);
  background: color-mix(in oklab, var(--card) 55%, transparent);
  color: var(--foreground);
  -webkit-backdrop-filter: blur(12px) saturate(150%);
  backdrop-filter: blur(12px) saturate(150%);
  box-shadow: inset 0 1px 0 color-mix(in oklab, var(--card) 60%, transparent);
  transition:
    background 0.25s,
    color 0.25s,
    border-color 0.25s,
    transform 0.25s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.25s;
}

.auth-toolbar :deep(button:hover),
.auth-theme-toggle:hover {
  background: color-mix(in oklab, var(--card) 80%, transparent);
  border-color: color-mix(in oklab, var(--ring) 65%, transparent);
}

/* 自定义日夜切换按钮的位置与尺寸 */
.auth-theme-toggle {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  cursor: pointer;
}

/* 背景图片与蒙层过渡（非 View Transition 时的 fallback） */
.auth-bg-img {
  transition: filter 0.8s cubic-bezier(0.4, 0, 0.2, 1);
  animation: auth-bg-zoom 26s cubic-bezier(0.22, 1, 0.36, 1) both;
  will-change: transform;
}

.auth-overlay {
  transition: background 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}

/* ===================== 入场动画 ===================== */
.auth-rise {
  animation: auth-rise 0.85s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.auth-delay-1 {
  animation-delay: 120ms;
}

.auth-delay-2 {
  animation-delay: 240ms;
}

@keyframes auth-rise {
  from {
    opacity: 0;
    transform: translate3d(0, 16px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

@keyframes auth-bg-zoom {
  from {
    transform: scale(1.07);
  }
  to {
    transform: scale(1);
  }
}

/* ===================== 玻璃拟态特性卡 ===================== */
/* 全部取色自 --card / --border / --ring / --foreground / --primary，随主题联动 */
.auth-feature-card {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border-radius: 1rem;
  color: var(--card-foreground);
  border: 1px solid color-mix(in oklab, var(--border) 50%, transparent);
  background: color-mix(in oklab, var(--card) 62%, transparent);
  -webkit-backdrop-filter: blur(22px) saturate(170%);
  backdrop-filter: blur(22px) saturate(170%);
  box-shadow:
    inset 0 1px 0 color-mix(in oklab, var(--card) 85%, transparent),
    0 10px 28px -16px color-mix(in oklab, var(--foreground) 32%, transparent);
  /* backwards：动画结束后还原基础样式，避免 fill 状态锁死 hover 的 transform */
  animation: auth-rise 0.8s cubic-bezier(0.22, 1, 0.36, 1) backwards;
  transition:
    transform 0.45s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.45s ease,
    border-color 0.45s ease,
    background 0.45s ease;
}

/* 悬停扫光：一道斜向高光自左向右掠过 */
.auth-feature-card::after {
  content: '';
  position: absolute;
  inset: -50% -140%;
  background: linear-gradient(
    100deg,
    transparent 38%,
    color-mix(in oklab, var(--card) 65%, transparent) 50%,
    transparent 62%
  );
  opacity: 0;
  pointer-events: none;
  transform: translate3d(-60%, 0, 0);
}

.auth-feature-card:hover {
  transform: translate3d(0, -6px, 0) scale(1.015);
  border-color: color-mix(in oklab, var(--ring) 60%, transparent);
  background: color-mix(in oklab, var(--card) 80%, transparent);
  box-shadow:
    inset 0 1px 0 color-mix(in oklab, var(--card) 95%, transparent),
    0 22px 46px -20px color-mix(in oklab, var(--foreground) 40%, transparent);
}

.auth-feature-card:hover::after {
  opacity: 1;
  animation: auth-shine 1.05s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes auth-shine {
  from {
    transform: translate3d(-60%, 0, 0);
  }
  to {
    transform: translate3d(60%, 0, 0);
  }
}

/* 卡片内图标玻璃块：悬停时轻微旋转放大 */
.auth-feature-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.75rem;
  color: var(--primary);
  border: 1px solid color-mix(in oklab, var(--border) 45%, transparent);
  background: color-mix(in oklab, var(--card) 72%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in oklab, var(--card) 85%, transparent);
  transition:
    transform 0.45s cubic-bezier(0.22, 1, 0.36, 1),
    background 0.45s ease,
    border-color 0.45s ease;
}

.auth-feature-card:hover .auth-feature-icon {
  transform: rotate(-6deg) scale(1.1);
  border-color: color-mix(in oklab, var(--primary) 40%, transparent);
  background: color-mix(in oklab, var(--primary) 16%, transparent);
}

/* ===================== 标题渐变流光 ===================== */
.auth-sheen {
  background-size: 220% 100%;
  background-position: 0% 50%;
  animation:
    auth-rise 0.85s cubic-bezier(0.22, 1, 0.36, 1) 80ms both,
    auth-sheen-shift 9s ease-in-out 1.2s infinite;
}

@keyframes auth-sheen-shift {
  0%,
  100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}

/* 主题按钮：悬停微抬、按下回弹 */
.auth-theme-toggle:hover {
  transform: translateY(-1px);
}

.auth-theme-toggle:active {
  transform: scale(0.94);
}

.auth-theme-toggle:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--background),
    0 0 0 4px var(--ring);
}

/* 尊重系统"减弱动态效果"设置 */
@media (prefers-reduced-motion: reduce) {
  .auth-rise,
  .auth-feature-card,
  .auth-bg-img,
  .auth-sheen {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }

  .auth-feature-card::after {
    display: none;
  }

  .auth-feature-card:hover,
  .auth-feature-card:hover .auth-feature-icon {
    transform: none;
  }
}
</style>
