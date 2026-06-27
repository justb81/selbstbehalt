// SPDX-License-Identifier: Apache-2.0
// Conventional Commits enforcement (https://www.conventionalcommits.org/).
// Wired into the `commit-msg` Git hook; see CONTRIBUTING/README for the convention.
export default {
  extends: ['@commitlint/config-conventional'],
};
