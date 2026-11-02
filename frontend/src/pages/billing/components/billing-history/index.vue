<script setup lang="ts">
import { DataTable } from '@/components/data-table'

import { columns } from './columns'
import billings from './data/billings.json' with { type: 'json' }
import type { Billing } from './data/schema'
</script>

<template>
  <DataTable :data="billings as unknown as Billing[]" :columns>
    <template #toolbar>
      <h2 class="my-2 mb-4 text-lg font-bold">Billing History</h2>
    </template>
  </DataTable>
</template>
