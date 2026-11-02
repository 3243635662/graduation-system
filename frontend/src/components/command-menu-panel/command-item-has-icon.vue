<script setup lang="ts">
import { MilestoneIcon } from '@lucide/vue'
import type { Component } from 'vue'

const { icon } = defineProps<{
  name: string
  icon?: Component
}>()
</script>

<template>
  <div class="flex items-center gap-2">
    <component :is="icon" v-if="icon" class="size-4" />
    <MilestoneIcon v-else class="size-4" />
    {{ name }}
  </div>
</template>
