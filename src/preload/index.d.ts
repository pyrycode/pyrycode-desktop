import type { PyryApi } from './index'

declare global {
  interface Window {
    pyry: PyryApi
  }
}
