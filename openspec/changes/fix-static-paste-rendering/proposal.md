# Render static paste fields as text

Shared links and persisted paste metadata can reach HTML templates and inline
button handlers. Treating these values as markup permits script execution in
the editor's origin.

## Scope and approval

The user approved a focused rendering fix on the fork on October 12, 2026.
Encode text and attribute values for HTML, encode action arguments as JavaScript
strings before HTML encoding, and use textContent when markup is unnecessary.
Preserve the storage schema and the existing save, view, delete, and QR flows.

The change adds regression coverage for shared links, real IndexedDB records,
and button argument encoding. It does not change the native API or deployment
architecture. Upstream interest is requested in
[issue 13](https://github.com/meta-introspector/kant-zk-pastebin/issues/13);
an upstream pull request requires their response.
