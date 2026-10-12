# Static rendering investigation

The October 12, 2026 deployment investigation confirmed that a shared-link
title could execute an HTML event handler. The fork contains a focused
rendering fix with browser regressions. Upstream issue 13 asks whether the
maintainer wants a pull request.

## Dependency findings

The root package manifest declares Puppeteer 21, while the committed lockfile
describes a different package containing Playwright. Adding the declared test
runner required reconciling the lockfile with the existing manifest.
`npm audit` reports 10 high-severity findings in the Puppeteer dependency tree.
The audit reports none against Playwright. Resolving Puppeteer findings
requires a separate dependency review; the suggested automatic upgrade is a
major version change.

## Other observed behavior

An empty optional server URL is saved to localStorage, but reload replaces it
with the default because the reader uses a truthiness fallback. This behavior
is outside the approved rendering change.

The repository tracks generated dependency and test-result files despite
ignore rules. Run the static regression suite with its scratchpad output path
to avoid overwriting existing tracked test reports.
