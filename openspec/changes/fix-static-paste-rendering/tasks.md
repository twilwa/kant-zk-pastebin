# Rendering change validation

Beads issue `br-0k0y` owns this work. This file records the validation sequence;
Beads remains the task status source.

The shared-link regression failed on injected elements before the title and
metadata encoding change. The stored-paste regression then failed on its list
title before list and view rendering were fixed. The QR regression failed on
stored IPFS markup before metadata and action arguments were encoded.

The completed regression suite exercises encoding through real HTML parsing,
shared links through the browser, persistence through IndexedDB, and save,
view, delete, reload, and QR actions through the UI. All four tests pass in
Chrome without browser console or page errors.

The suite does not validate remote sync against the Rust backend or native OS
share dialogs. The native dependency registry was unreachable during the
deployment investigation.
