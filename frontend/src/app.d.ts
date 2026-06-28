// SPDX-License-Identifier: Apache-2.0
//
// SvelteKit ambient type declarations. The `App` namespace lets us type the
// framework's extension points (errors, page data, …) as the app grows; the
// interfaces stay empty until a feature needs them.

// Ambient types for the PWA virtual modules provided by @vite-pwa/sveltekit:
// `virtual:pwa-register/svelte` (the SW registration hook used by
// $lib/pwa/register) and `virtual:pwa-info`.
/// <reference types="vite-plugin-pwa/svelte" />
/// <reference types="vite-plugin-pwa/info" />

declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
