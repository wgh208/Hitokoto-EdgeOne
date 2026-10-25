#!/usr/bin/env node
/**
 * Local smoke test for lib/hitokoto.js.
 *
 * The function has no runtime network dependency, so this exercises the real
 * handler, compressed data and decompressor.  Run with:
 *   node scripts/smoke-test.mjs
 */
import assert from "node:assert/strict";

const { onRequest } = await import("../lib/hitokoto.js");

async function request(query = "", method = "GET") {
  return onRequest({
    request: new Request(`https://hitokotov2.wgh.me/${query}`, { method }),
    env: { DEV_ENV: "true" },
  });
}

let checks = 0;

{
  const response = await request("?c=a");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const body = await response.json();
  assert.equal(body.type, "a");
  assert.equal(typeof body.hitokoto, "string");
  assert.equal(typeof body.uuid, "string");
  checks += 1;
}

{
  const response = await request("");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok("abcdefghijkl".includes(body.type));
  checks += 1;
}

{
  const response = await request("?c=z");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).type, "a");
  checks += 1;
}

{
  const response = await request("?min_length=10&max_length=10");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.length, 10);
  checks += 1;
}

{
  const response = await request("?c=a&min_length=9999&max_length=10000");
  assert.equal(response.status, 404);
  checks += 1;
}

{
  const response = await request("?encode=text");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/plain/);
  const text = await response.text();
  assert.ok(text.length > 0 && !text.startsWith('"'));
  checks += 1;
}

{
  const response = await request("?encode=js&select=%23hitokoto");
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(text.startsWith("(function hitokoto()"));
  assert.ok(text.includes('document.querySelector("#hitokoto")'));
  checks += 1;
}

{
  const response = await request("?encode=json&callback=cb");
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(text.startsWith(";cb("));
  const argument = text.slice(4, -2);
  assert.doesNotThrow(() => JSON.parse(JSON.parse(argument)));
  checks += 1;
}

{
  const response = await request("", "OPTIONS");
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  checks += 1;
}

{
  const response = await request("?min_length=0");
  assert.equal(response.status, 400);
  checks += 1;
}

{
  const response = await request("?min_length=10&max_length=5");
  assert.equal(response.status, 400);
  checks += 1;
}

console.log(`All ${checks} smoke checks passed.`);
