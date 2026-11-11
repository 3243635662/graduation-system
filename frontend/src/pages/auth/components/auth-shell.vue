<script setup lang="ts">
import LanguageChange from '@/components/language-change.vue'
import { GraduationCapIcon, MoonIcon, ShieldCheckIcon, SunIcon } from '@lucide/vue'
import { useColorMode } from '@vueuse/core'
import type { Component } from 'vue'
import { computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

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
    features: () => [],
  },
)

const { t } = useI18n()
const mode = useColorMode()

// props 默认值只在创建时求值一次，故用 computed 回退到词条以跟随语言切换
const heroTitleText = computed(() => props.heroTitle ?? t('authShell.hero.title'))
const heroHighlightText = computed(() => props.heroHighlight ?? t('authShell.hero.highlight'))
const heroTaglineText = computed(() => props.heroTagline ?? t('authShell.hero.tagline'))
const securityNoticeText = computed(() => props.securityNotice ?? t('authShell.securityNotice'))

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
  <!--
    全屏固定：页面本身不滚动，高度恒为一个视口（dvh 随手机软键盘收缩）。
    表单单据变高时（如出现校验提示）只让中间区域内部滚动，顶栏与底栏保持不动。
  -->
  <div
    class="relative isolate flex h-dvh w-full flex-col justify-between overflow-hidden bg-background text-foreground selection:bg-primary selection:text-primary-foreground"
  >
    <!-- 背景图片与蒙层：白天完全不加蒙层，保留照片原貌；仅夜间压暗 -->
    <div class="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-background">
      <img
        :src="backgroundImage"
        :srcset="bgSrcset"
        sizes="max(100vw, 178vh)"
        :alt="$t('authShell.backgroundAlt')"
        decoding="async"
        fetchpriority="high"
        class="h-full w-full animate-auth-bg-zoom object-cover object-center contrast-[1.02] transition-[filter] duration-800 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform motion-reduce:animate-none dark:brightness-[0.86] dark:contrast-[1.06] dark:saturate-[1.06]"
      />

      <!--
        夜间蒙层 + 主色晕染（让 6 套主题在夜间彼此可区分）。
        这里刻意不加 opacity 过渡：主题切换由 View Transition 圆形揭幕负责，
        若此处再过渡，新帧快照会捕获到半透明状态，导致夜间压暗不到位。
      -->
      <div
        class="absolute inset-0 bg-linear-to-b from-background/46 via-background/33 to-background/42 opacity-0 dark:opacity-100"
      />
      <div
        class="absolute inset-0 bg-linear-to-tr from-primary/8 via-transparent to-primary/5 opacity-0 dark:opacity-100"
      />
    </div>

    <!-- 顶栏 -->
    <header
      class="relative z-20 mx-auto flex w-full max-w-7xl shrink-0 items-center justify-between px-6 pt-5 pb-2 sm:px-10 lg:px-12"
    >
      <router-link
        to="/"
        class="group flex items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div
          class="glass-surface flex size-9 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-105"
        >
          <GraduationCapIcon class="size-5 text-primary" />
        </div>
        <div class="flex flex-col text-media-foreground drop-shadow-md">
          <span class="text-base leading-tight font-bold tracking-tight">{{
            $t('authShell.brandName')
          }}</span>
          <span
            class="text-[10px] leading-tight font-normal tracking-wider text-media-foreground/80 uppercase"
            >{{ $t('authShell.brandSubtitle') }}</span
          >
        </div>
      </router-link>

      <div class="auth-toolbar flex items-center gap-2">
        <LanguageChange />

        <!-- 自定义日夜切换按钮：圆形扩散揭幕动画 -->
        <button
          type="button"
          class="relative flex size-8 cursor-pointer items-center justify-center rounded-lg hover:-translate-y-px active:scale-[0.94]"
          :aria-label="$t(mode === 'dark' ? 'authShell.theme.toLight' : 'authShell.theme.toDark')"
          :title="$t(mode === 'dark' ? 'authShell.theme.toLight' : 'authShell.theme.toDark')"
          @click="toggleTheme"
        >
          <SunIcon
            class="absolute size-4 scale-100 rotate-0 transition-transform duration-500 dark:-rotate-90 dark:scale-0"
          />
          <MoonIcon
            class="absolute size-4 scale-0 rotate-90 transition-transform duration-500 dark:rotate-0 dark:scale-100"
          />
        </button>
      </div>
    </header>

    <!-- 中间核心区：内容超高时只在这里内部滚动，用 m-auto 居中且不会裁掉顶部 -->
    <main
      class="relative z-20 mx-auto flex w-full max-w-7xl min-h-0 flex-1 overflow-y-auto px-6 py-2 sm:px-10 lg:px-12"
    >
      <div class="m-auto grid w-full items-center gap-8 lg:grid-cols-12 lg:gap-12">
        <!-- 左侧文案与 3 个玻璃特性卡 -->
        <section class="flex flex-col justify-center py-2 lg:col-span-7">
          <div class="space-y-3 sm:space-y-4">
            <h1
              class="animate-auth-rise text-3xl leading-[1.12] font-extrabold tracking-tight text-media-foreground drop-shadow-lg motion-reduce:animate-none sm:text-4xl lg:text-5xl"
            >
              <span>{{ heroTitleText }}</span>
              <span
                class="mt-1 block animate-auth-sheen bg-linear-to-r from-media-foreground via-media-foreground to-primary bg-clip-text bg-position-[0%_50%] bg-size-[220%_100%] font-serif font-semibold text-transparent italic motion-reduce:animate-none sm:mt-1.5"
              >
                {{ heroHighlightText }}
              </span>
            </h1>

            <div
              class="flex animate-auth-rise items-center gap-3 text-xs font-medium tracking-wide text-media-foreground/80 drop-shadow-md [animation-delay:120ms] motion-reduce:animate-none sm:text-sm"
            >
              <span class="h-[2px] w-6 rounded-full bg-media-foreground/80" />
              <span>{{ heroTaglineText }}</span>
            </div>
          </div>

          <!-- 底部 3 块水岸浮动玻璃拟态特性卡（玻璃效果见 auth-glass-tile utility） -->
          <div class="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:mt-12">
            <div
              v-for="(item, idx) in features"
              :key="idx"
              class="auth-glass-tile relative isolate flex animate-auth-rise-in items-center gap-2.5 overflow-hidden rounded-2xl p-3 motion-reduce:animate-none"
              :style="{ animationDelay: `${260 + idx * 90}ms` }"
            >
              <div
                class="auth-glass-tile-icon flex size-9 shrink-0 items-center justify-center rounded-xl"
              >
                <component :is="item.icon" class="size-4" />
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="truncate text-xs font-semibold tracking-wide">{{ item.title }}</span>
                <span v-if="item.subtitle" class="mt-0.5 truncate text-[10px] opacity-70">{{
                  item.subtitle
                }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 右侧表单卡片插槽 -->
        <section
          class="flex animate-auth-rise justify-center [animation-delay:240ms] motion-reduce:animate-none lg:col-span-5 lg:justify-end"
        >
          <slot />
        </section>
      </div>
    </main>

    <!-- 底栏 -->
    <footer
      class="relative z-20 mx-auto flex w-full max-w-7xl shrink-0 flex-col items-center justify-between gap-2 px-6 py-3 text-xs text-media-foreground/85 drop-shadow-md sm:flex-row sm:px-10 lg:px-12"
    >
      <div class="flex items-center gap-1.5">
        <ShieldCheckIcon class="size-3.5 shrink-0 text-media-foreground" />
        <span class="text-[11px] sm:text-xs">{{ securityNoticeText }}</span>
      </div>

      <!-- 暂无条款 / 隐私 / 帮助页面，因此保持不可点击的纯文本（不设 cursor-pointer） -->
      <div class="flex items-center gap-3 text-[11px] sm:text-xs">
        <span>{{ $t('authShell.footer.terms') }}</span>
        <span aria-hidden="true">|</span>
        <span>{{ $t('authShell.footer.privacy') }}</span>
        <span aria-hidden="true">|</span>
        <span>{{ $t('authShell.footer.help') }}</span>
      </div>
    </footer>
  </div>
</template>

<!--
  只保留两件 Tailwind 表达不了的事：
  1. 卡片悬停扫光的 ::after 伪元素（没有对应 class）；
  2. prefers-reduced-motion 覆盖，需要压过 utilities 层里的悬停位移。
  View Transition 伪元素与工具栏穿透选择器在 assets/auth-effects.css。
-->
<style scoped>
/* 悬停扫光：一道斜向高光自左向右掠过 */
.auth-glass-tile::after {
  content: '';
  position: absolute;
  inset: -50% -140%;
  background: linear-gradient(
    100deg,
    transparent 38%,
    color-mix(in oklab, var(--media-foreground) 26%, transparent) 50%,
    transparent 62%
  );
  opacity: 0;
  pointer-events: none;
  transform: translate3d(-60%, 0, 0);
}

.auth-glass-tile:hover::after {
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

/* 尊重系统「减弱动态效果」设置：停用扫光与悬停位移 */
@media (prefers-reduced-motion: reduce) {
  .auth-glass-tile::after {
    display: none;
  }

  .auth-glass-tile:hover,
  .auth-glass-tile:hover .auth-glass-tile-icon {
    transform: none;
  }
}
</style>
