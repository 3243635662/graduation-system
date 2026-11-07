<script setup lang="ts">
import { GraduationCapIcon, ShieldCheckIcon, SparklesIcon } from '@lucide/vue'

import AuthShell from './components/auth-shell.vue'
import RegisterForm from './components/register-form.vue'

const registerFeatures = [
  {
    icon: SparklesIcon,
    title: 'Smart Matching',
    subtitle: '智能双向选题与立项',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Process Tracking',
    subtitle: '全周期节点规范闭环',
  },
  {
    icon: GraduationCapIcon,
    title: 'Milestone Defense',
    subtitle: '答辩考核与学位归档',
  },
]
</script>

<template>
  <AuthShell
    background-image="/images/auth/campus-dusk.png"
    hero-title="Start Your"
    hero-highlight="Academic Journey"
    hero-tagline="Standardized · Intelligent · Collaborative"
    :features="registerFeatures"
    security-notice="Your data is secure with us · 高校毕业设计综合管理平台"
  >
    <RegisterForm />
  </AuthShell>
</template>
