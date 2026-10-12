// ABOUTME: Exposes production Durable Objects to local integration tests.
// ABOUTME: Contains no authentication route or replacement room implementation.
export { Room } from "../src/room";
export { Access } from "../src/access";
export default {
  fetch() {
    return new Response("test runtime");
  },
};
