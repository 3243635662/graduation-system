<script setup lang="ts">
import { reactiveOmit } from '@vueuse/core'
import type { DialogTitleProps } from 'reka-ui'
import { useForwardProps } from 'reka-ui'
import type { DrawerTitleProps } from 'vaul-vue'
import type { HTMLAttributes } from 'vue'

import { useModal } from './use-modal'

type Props = (DialogTitleProps | DrawerTitleProps) & { class?: HTMLAttributes['class'] }

const props = defineProps<Props>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)

const { Modal } = useModal()
</script>

<template>
  <component :is="Modal.Title" v-bind="forwardedProps" :class="props.class">
    <slot />
  </component>
</template>
