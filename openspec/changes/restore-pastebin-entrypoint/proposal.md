# Independent pastebin and room entrypoints

The user requested that the original Kant pastebin remain available separately
from the Delve-focused room service. This change deploys the existing standalone
editor at `pastebin.xware.online` and links both applications to each other.

The editor keeps pastes in browser storage and shares their contents in URL
fragments. Server synchronization remains optional and starts unconfigured on
this deployment. Local pastes must be shareable without a native server. Bundle
the QR dependency and the existing downloadable CLI with the hosted assets.

The room service and its access controls remain at `pastebin-app.xware.online`.
Existing `/r/<id>` redirects from the short hostname continue working. This
change does not deploy the Rust server, an IPFS node, or new cryptography.

Authorization: the user's request to restore the pastebin entrypoint and permit
navigation away from the Delve app. Work and validation: Beads `br-mgep.4`.
