<script setup lang="ts">
import { Modal, ModalContent, ModalTrigger } from '@/components/prop-ui/modal'
import { Button } from '@/components/ui/button'
import { PlusIcon } from '@lucide/vue'

import TaskResourceDialog from './task-resource-dialog.vue'

const isOpen = shallowRef(false)
</script>

<template>
  <Modal v-model:open="isOpen">
    <ModalTrigger as-child>
      <Button>
        Create
        <PlusIcon />
      </Button>
    </ModalTrigger>

    <ModalContent>
      <TaskResourceDialog :task="null" @close="isOpen = false" />
    </ModalContent>
  </Modal>
</template>
