<script setup lang="ts">
import { AwardIcon, GraduationCapIcon, UsersIcon } from '@lucide/vue'

import AuthShell from './components/auth-shell.vue'
import LoginForm from './components/login-form.vue'

const loginFeatures = [
  {
    icon: GraduationCapIcon,
    title: 'Academic Excellence',
    subtitle: '学术规范与质量把控',
  },
  {
    icon: UsersIcon,
    title: 'Collaborative Research',
    subtitle: '师生协同与全程指导',
  },
  {
    icon: AwardIcon,
    title: 'Dream Achievement',
    subtitle: '成果答辩与卓越赋能',
  },
]
</script>

<template>
  <AuthShell
    background-image="/images/auth/campus-lake.png"
    hero-title="Build a Better"
    hero-highlight="Future Together"
    hero-tagline="Innovative · Professional · Efficient"
    :features="loginFeatures"
    security-notice="Your data is secure with us · 高校毕业设计综合管理平台"
  >
    <LoginForm />
  </AuthShell>
</template>
