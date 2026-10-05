import { defineExtension } from '@earendil-works/pi-durable'
import { createWebTools } from '../../../tools/web/index.ts'

export default defineExtension({ name: 'web', tools: createWebTools() })
