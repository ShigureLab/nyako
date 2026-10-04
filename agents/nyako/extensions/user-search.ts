import { defineExtension } from '@earendil-works/pi-durable'
import { createSearchUserBindingsTool } from '../../../tools/users/search.ts'

export default defineExtension({
  name: 'user-search',
  tools: [createSearchUserBindingsTool()],
})
