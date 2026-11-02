<script setup lang="ts">
import { ModalDescription, ModalHeader, ModalTitle } from '@/components/prop-ui/modal'
import { VisuallyHidden } from 'reka-ui'

import TransactionCard from '../transaction-card/index.vue'
import type { Billing } from './data/schema'

defineProps<{
  billing: Billing
}>()
</script>

<template>
  <div>
    <ModalHeader>
      <VisuallyHidden as-child>
        <ModalTitle />
      </VisuallyHidden>
      <VisuallyHidden as-child>
        <ModalDescription :aria-describedby="undefined" />
      </VisuallyHidden>
    </ModalHeader>

    <TransactionCard
      :card-no="billing.id"
      :order-id="billing.orderId || ''"
      :price="billing.amount"
      currency="$"
      :state="billing.status"
      :updated-at="billing.date"
      :invoice-no="`${billing.id}`"
      :description="billing.description"
    />
  </div>
</template>
