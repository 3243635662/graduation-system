<script setup lang="ts">
import { GraduationCapIcon, ShieldCheckIcon, SparklesIcon } from '@lucide/vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AuthShell from './components/auth-shell.vue'
import RegisterForm from './components/register-form.vue'

const { t } = useI18n()

// computed 让特性卡文案随语言切换即时更新
const registerFeatures = computed(() => [
  {
    icon: SparklesIcon,
    title: t('authShell.signUp.features.matching.title'),
    subtitle: t('authShell.signUp.features.matching.subtitle'),
  },
  {
    icon: ShieldCheckIcon,
    title: t('authShell.signUp.features.tracking.title'),
    subtitle: t('authShell.signUp.features.tracking.subtitle'),
  },
  {
    icon: GraduationCapIcon,
    title: t('authShell.signUp.features.defense.title'),
    subtitle: t('authShell.signUp.features.defense.subtitle'),
  },
])
</script>

<template>
  <AuthShell
    background-image="/images/auth/campus-dusk.png"
    :hero-title="$t('authShell.signUp.hero.title')"
    :hero-highlight="$t('authShell.signUp.hero.highlight')"
    :hero-tagline="$t('authShell.signUp.hero.tagline')"
    :features="registerFeatures"
  >
    <RegisterForm />
  </AuthShell>
</template>
