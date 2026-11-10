<script setup lang="ts">
import { AwardIcon, GraduationCapIcon, UsersIcon } from '@lucide/vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AuthShell from './components/auth-shell.vue'
import LoginForm from './components/login-form.vue'

const { t } = useI18n()

// computed 让特性卡文案随语言切换即时更新
const loginFeatures = computed(() => [
  {
    icon: GraduationCapIcon,
    title: t('authShell.signIn.features.academic.title'),
    subtitle: t('authShell.signIn.features.academic.subtitle'),
  },
  {
    icon: UsersIcon,
    title: t('authShell.signIn.features.collaboration.title'),
    subtitle: t('authShell.signIn.features.collaboration.subtitle'),
  },
  {
    icon: AwardIcon,
    title: t('authShell.signIn.features.achievement.title'),
    subtitle: t('authShell.signIn.features.achievement.subtitle'),
  },
])
</script>

<template>
  <AuthShell
    background-image="/images/auth/campus-lake.png"
    :hero-title="$t('authShell.signIn.hero.title')"
    :hero-highlight="$t('authShell.signIn.hero.highlight')"
    :hero-tagline="$t('authShell.signIn.hero.tagline')"
    :features="loginFeatures"
  >
    <LoginForm />
  </AuthShell>
</template>
