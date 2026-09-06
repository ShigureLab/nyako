import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import registerUserBindingTool from '../../../tools/users/index.ts'
import registerSearchUserBindingsTool from '../../../tools/users/search.ts'

export default function registerUserTools(pi: ExtensionAPI): void {
  registerUserBindingTool(pi)
  registerSearchUserBindingsTool(pi)
}
