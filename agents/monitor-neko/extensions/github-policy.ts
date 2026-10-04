import { defineExtension } from '@earendil-works/pi-durable'
import { createGithubPolicyTool } from '../../../tools/github/index.ts'

export default defineExtension({
  name: 'github-policy',
  tools: [createGithubPolicyTool()],
})
