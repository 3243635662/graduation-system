<script setup lang="ts">
import Loading from '@/components/loading.vue'
import { Toaster } from '@/components/ui/sonner'
import { useSystemTheme } from '@/composables/use-system-theme'
import { envError } from '@/utils/env'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { z } from 'zod'

const { t } = useI18n()

useSystemTheme()

onMounted(() => {
  if (envError) {
    const flattenError = z.flattenError(envError)
    toast.error(t('envError'), {
      description: h(
        'pre',
        { class: 'mt-2 rounded-md bg-slate-950 p-4 text-wrap' },
        h('code', { class: 'text-white' }, JSON.stringify(flattenError, null, 2)),
      ),
      duration: 10000,
    })
  }
})
</script>

<template>
  <Toaster />

  <Suspense>
    <router-view v-slot="{ Component }">
      <component :is="Component" />
    </router-view>

    <template #fallback>
      <Loading />
    </template>
  </Suspense>
</template>
