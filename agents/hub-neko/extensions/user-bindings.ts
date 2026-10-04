import { defineExtension } from '@earendil-works/pi-durable'
import { createUserBindingTool } from '../../../tools/users/index.ts'
import { createSearchUserBindingsTool } from '../../../tools/users/search.ts'

export default defineExtension({
  name: 'user-bindings',
  tools: [createUserBindingTool(), createSearchUserBindingsTool()],
})
