import { subfLint } from '@subf/config/oxlint'

export default subfLint({
  ignorePatterns: ['*.d.ts'],
  lib: true,
})
