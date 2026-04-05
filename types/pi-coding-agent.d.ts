declare module '@mariozechner/pi-coding-agent' {
  export type ToolResult = {
    content: Array<{ type: string; text: string }>
    details?: unknown
  }

  export type RegisteredTool = {
    name: string
    label?: string
    description?: string
    parameters?: unknown
    execute: (toolCallId: string, input: any) => Promise<ToolResult>
  }

  export type ExtensionAPI = {
    registerTool(tool: RegisteredTool): void
  }
}
