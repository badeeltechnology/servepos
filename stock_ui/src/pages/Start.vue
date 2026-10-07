<template><div class="px-5 pt-5"><LoadingText /></div></template>
<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { LoadingText } from 'frappe-ui'
import { state, isProvider, shipsHere } from '../state'
const router = useRouter()
onMounted(() => {
  if (!state.location) return router.replace(state.ctx && state.ctx.is_buyer ? '/buy' : '/home')
  if (isProvider.value && shipsHere.value) return router.replace('/picking')
  if (isProvider.value) return router.replace('/list/incoming')
  router.replace('/home')
})
</script>
