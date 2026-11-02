<script setup lang="ts">
import { reactiveOmit } from '@vueuse/core'
import type { DialogDescriptionProps } from 'reka-ui'
import { useForwardProps } from 'reka-ui'
import type { DrawerDescriptionProps } from 'vaul-vue'
import type { HTMLAttributes } from 'vue'

import { useModal } from './use-modal'

type Props = (DrawerDescriptionProps | DialogDescriptionProps) & { class?: HTMLAttributes['class'] }

const props = defineProps<Props>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)

const { Modal } = useModal()
</script>

<template>
  <component :is="Modal.Description" v-bind="forwardedProps" :class="props.class">
    <slot />
  </component>
</template>
