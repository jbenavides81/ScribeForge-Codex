import type { ScribeForgeApi } from '../../shared/api';

declare global {
  interface Window {
    scribeforge: ScribeForgeApi;
  }
}

export {};
