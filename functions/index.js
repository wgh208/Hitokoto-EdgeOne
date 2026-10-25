/**
 * EdgeOne Pages Functions entry point.
 * All request handling lives in ../lib/hitokoto.js.
 */
import { onRequest as handleRequest } from "../lib/hitokoto.js";

export function onRequest(context) {
  return handleRequest(context);
}
