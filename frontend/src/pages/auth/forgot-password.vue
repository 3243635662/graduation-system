<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { GraduationCapIcon, ShieldCheckIcon, SparklesIcon } from '@lucide/vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AuthShell from './components/auth-shell.vue'

const router = useRouter()
const { t } = useI18n()

// computed 让特性卡文案随语言切换即时更新
const features = computed(() => [
  {
    icon: SparklesIcon,
    title: t('authShell.forgotPassword.features.security.title'),
    subtitle: t('authShell.forgotPassword.features.security.subtitle'),
  },
  {
    icon: ShieldCheckIcon,
    title: t('authShell.forgotPassword.features.protection.title'),
    subtitle: t('authShell.forgotPassword.features.protection.subtitle'),
  },
  {
    icon: GraduationCapIcon,
    title: t('authShell.forgotPassword.features.support.title'),
    subtitle: t('authShell.forgotPassword.features.support.subtitle'),
  },
])
</script>

<template>
  <AuthShell
    background-image="/images/auth/campus-lake.png"
    :hero-title="$t('authShell.forgotPassword.hero.title')"
    :hero-highlight="$t('authShell.forgotPassword.hero.highlight')"
    :hero-tagline="$t('authShell.forgotPassword.hero.tagline')"
    :features="features"
  >
    <div class="w-full max-w-[430px] rounded-[32px] glass-card p-7 sm:p-9 relative overflow-hidden">
      <div class="mb-2">
        <div
          class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold tracking-wider text-primary bg-primary/10 border border-primary/20"
        >
          <span>SECURITY</span>
          <span class="w-3 h-[2px] bg-primary rounded-full" />
        </div>
      </div>

      <div class="mb-6">
        <h2 class="text-2xl sm:text-3xl font-extrabold tracking-tight text-card-foreground">
          找回密码
        </h2>
        <p class="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
          该功能暂未对公网开放。如需重置密码，请联系所在学院教学秘书或学校系统管理员。
        </p>
      </div>

      <Button
        class="w-full h-12 rounded-xl text-sm sm:text-base font-semibold text-primary-foreground bg-primary shadow-lg shadow-primary/25 hover:bg-primary/90 cursor-pointer"
        @click="router.push('/auth/sign-in')"
      >
        返回登录
      </Button>
    </div>
  </AuthShell>
</template>
