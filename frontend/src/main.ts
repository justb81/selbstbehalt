// SPDX-License-Identifier: Apache-2.0
import { mount } from 'svelte';

import App from './App.svelte';

const target = document.getElementById('app');
if (!target) {
  throw new Error('Root element #app not found');
}

export default mount(App, { target });
