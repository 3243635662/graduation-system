<script setup lang="ts">
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ShuffleIcon } from '@lucide/vue'

interface User {
  avatar: string
  name: string
  email: string
  amount: string
}

const list = ref<User[]>([
  { avatar: '', name: 'Olivia Martin', email: 'olivia.martin@email.com', amount: '$1,999.00' },
  { avatar: '', name: 'Jackson Lee', email: 'jackson.lee@email.com', amount: '$39.00' },
  { avatar: '', name: 'Isabella Nguyen', email: 'isabella.nguyen@email.com', amount: '$299.00' },
  { avatar: '', name: 'William Kim', email: 'will@email.com', amount: '$99.00' },
  { avatar: '', name: 'Sofia Davis', email: 'sofia.davis@email.com', amount: '$39.00' },
])

function shuffleList() {
  const shuffled = [...list.value]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const current = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = current
  }
  list.value = shuffled
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex justify-end">
      <Button variant="ghost" size="sm" @click="shuffleList">
        <ShuffleIcon data-icon="inline-start" />
        刷新顺序
      </Button>
    </div>

    <div v-auto-animate="{ duration: 250 }" class="flex flex-col gap-8">
      <div v-for="item in list" :key="item.name" class="flex items-center gap-4">
        <Avatar class-name="h-9 w-9">
          <AvatarImage :src="item.avatar" alt="Avatar" />
          <AvatarFallback>{{ item.name[0].toUpperCase() }}</AvatarFallback>
        </Avatar>
        <div class="flex flex-wrap items-center justify-between flex-1">
          <div class="space-y-1">
            <p class="text-sm font-medium leading-none">
              {{ item.name }}
            </p>
            <p class="text-sm text-muted-foreground">
              {{ item.email }}
            </p>
          </div>
          <div class="font-medium">
            {{ item.amount }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
