# Implementation tasks

Beads `br-mgep.2` is the source of task status. The supplied project workflow
requires Beads rather than a second Markdown TODO list.

| Sequence | Work | Verification |
| --- | --- | --- |
| 1 | Room validation, admission, persistence, expiry, closure, and idempotence | Red/green unit tests and real Workers storage integration tests |
| 2 | OAuth state, Delve identity, local sessions, and same-origin API | State/replay tests, real provider discovery, type check, no test-login route |
| 3 | Temporary DM browser flow and agent instructions | Real browser rendering/API tests, every visible action documented |
| 4 | Deploy exact hostnames and verify live service | Dry run, HTTPS/headers, real sign-in and two-account exchange, explicit remaining validation |
