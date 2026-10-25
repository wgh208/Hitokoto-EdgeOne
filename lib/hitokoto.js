/**
 * Hitokoto API for EdgeOne Pages.
 *
 * Sentence data is embedded as gzip + base64 modules (lib/data/*.js). A request
 * picks a category using a precomputed length histogram, decompresses only that
 * category with the vendored fflate build, and returns a random matching
 * sentence. This keeps the edge function bundle small and avoids runtime
 * network requests.
 */
import sentenceIndex from "./sentence-index.js";
import { compressedSentences } from "./data/index.js";
import { gunzipSync } from "./vendor/fflate.js";

const SOURCE_CODE = "https://github.com/wgh208/Hitokoto-EdgeOne";

const responseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "X-Content-Type-Options": "nosniff",
  "X-Source-Code": SOURCE_CODE,
};

const CATEGORY_KEYS = Object.keys(sentenceIndex.categories).sort();

// Per-isolate cache.  EdgeOne reuses isolates, so after the first request for a
// category the JSON is served from memory.  At most 12 categories (~4.5 MB)
// can be cached; typical deployments only touch a few.
const sentenceCache = new Map();

function jsonResponse(body, status = 200, extraHeaders = {}) {
  // Build responses with the Response constructor for consistent behavior
  // across edge runtimes.
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      ...extraHeaders,
      ...responseHeaders,
      "Cache-Control": "no-store",
    },
  });
}

function createResponse(code, message, extraData = {}, extraHeaders = {}) {
  return jsonResponse(
    {
      code,
      message,
      timestamp: Date.now(),
      ...extraData,
    },
    code,
    extraHeaders,
  );
}

function handleError(code, error, devEnv, customMessage = "服务器内部错误") {
  if (String(devEnv).toLowerCase() === "true") {
    return createResponse(code, error?.message || String(error));
  }
  return createResponse(code, customMessage);
}

function categoryName(value) {
  if (!value) return "";
  return String(value);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function gunzip(bytes) {
  // Synchronous, pure-JS gunzip from the vendored fflate build. It has no
  // network or platform stream dependency.
  return new TextDecoder().decode(gunzipSync(bytes));
}

async function loadCategory(key) {
  const cached = sentenceCache.get(key);
  if (cached) return cached;

  const compressed = compressedSentences[key];
  if (!compressed) {
    throw new Error(`No embedded sentence data for category "${key}"`);
  }

  let stage = "base64";
  try {
    const bytes = base64ToBytes(compressed);
    stage = "gunzip";
    const text = await gunzip(bytes);
    stage = "json";
    const list = JSON.parse(text);

    if (!Array.isArray(list)) {
      throw new Error(`expected an array, got ${typeof list}`);
    }

    sentenceCache.set(key, list);
    return list;
  } catch (error) {
    throw new Error(`[${key}] ${stage}: ${error?.message || String(error)}`);
  }
}

function eligibleCount(key, minLength, maxLength) {
  const info = sentenceIndex.categories[key];
  if (!info) return 0;

  let count = 0;
  for (const [rawLength, bucketCount] of Object.entries(info.lengths)) {
    const length = Number(rawLength);
    if (length >= minLength && length <= maxLength) {
      count += bucketCount;
    }
  }
  return count;
}

/**
 * Pick a category with probability proportional to its eligible sentence count.
 * `excluded` lets the caller retry other categories if an index is momentarily
 * out of date.
 */
function pickCategory(minLength, maxLength, excluded = new Set()) {
  let totalEligible = 0;
  const candidates = [];

  for (const key of CATEGORY_KEYS) {
    if (excluded.has(key)) continue;
    const count = eligibleCount(key, minLength, maxLength);
    if (count > 0) {
      candidates.push([key, count]);
      totalEligible += count;
    }
  }

  if (totalEligible === 0) return null;

  let needle = Math.random() * totalEligible;
  for (const [key, count] of candidates) {
    if (needle < count) return key;
    needle -= count;
  }
  return candidates[candidates.length - 1][0];
}

function filterByLength(list, minLength, maxLength) {
  return list.filter((sentence) => {
    const length = Number(sentence?.length);
    const isMinValid = !minLength || length >= minLength;
    const isMaxValid = !maxLength || length <= maxLength;
    return isMinValid && isMaxValid;
  });
}

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function buildPayload(sentence) {
  return {
    id: sentence.id,
    uuid: sentence.uuid,
    hitokoto: sentence.hitokoto,
    type: sentence.type,
    from: sentence.from,
    from_who: sentence.from_who,
    creator: sentence.creator,
    creator_uid: sentence.creator_uid,
    reviewer: sentence.reviewer,
    commit_from: sentence.commit_from,
    created_at: sentence.created_at,
    length: sentence.length,
  };
}

function textResponse(content, contentType) {
  return new Response(content, {
    headers: {
      "Content-Type": `${contentType}; charset=UTF-8`,
      ...responseHeaders,
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...responseHeaders,
          "Cache-Control": "no-store",
        },
      });
    }

    const url = new URL(request.url);
    const requestedCategory = categoryName(url.searchParams.get("c"));
    const encodeType = url.searchParams.get("encode");
    const callback = url.searchParams.get("callback");
    const select = url.searchParams.get("select");

    const minLength = url.searchParams.has("min_length")
      ? Number.parseInt(url.searchParams.get("min_length"), 10)
      : 0;

    const maxLength = url.searchParams.has("max_length")
      ? Number.parseInt(url.searchParams.get("max_length"), 10)
      : 30;

    if (
      url.searchParams.has("min_length") &&
      (!Number.isInteger(minLength) || minLength <= 0)
    ) {
      return createResponse(400, "min_length 必须是正整数");
    }

    if (
      url.searchParams.has("max_length") &&
      (!Number.isInteger(maxLength) || maxLength <= 0)
    ) {
      return createResponse(400, "max_length 必须是正整数");
    }

    if (maxLength < minLength) {
      return createResponse(400, "max_length 不能小于 min_length");
    }

    // Original behaviour: unknown category falls back to "a".
    const onlyCategory = requestedCategory
      ? CATEGORY_KEYS.includes(requestedCategory)
        ? requestedCategory
        : "a"
      : "";

    let list;
    let matches;

    if (onlyCategory) {
      list = await loadCategory(onlyCategory);
      matches = filterByLength(list, minLength, maxLength);
      if (matches.length === 0) {
        return createResponse(404, "没有在该类别找到符合长度条件的一言");
      }
    } else {
      const excluded = new Set();
      matches = [];

      while (matches.length === 0) {
        const key = pickCategory(minLength, maxLength, excluded);
        if (!key) break;

        excluded.add(key);
        list = await loadCategory(key);
        matches = filterByLength(list, minLength, maxLength);
      }

      if (matches.length === 0) {
        return createResponse(404, "没有找到符合长度条件的一言");
      }
    }

    const sentence = randomItem(matches);
    const payload = buildPayload(sentence);

    if (encodeType === "text") {
      const content = callback
        ? `;${callback}(${JSON.stringify(sentence.hitokoto)});`
        : sentence.hitokoto;
      return textResponse(
        content,
        callback ? "application/javascript" : "text/plain",
      );
    }

    if (encodeType === "js") {
      const selector = select || ".hitokoto";
      const js = `(function hitokoto(){var hitokoto=${JSON.stringify(
        sentence.hitokoto,
      )};var dom=document.querySelector(${JSON.stringify(
        selector,
      )});if(!dom){return}if(Array.isArray(dom)){dom[0].innerText=hitokoto}else{dom.innerText=hitokoto}})()`;

      const content = callback ? `;${callback}(${JSON.stringify(js)});` : js;
      return textResponse(content, "application/javascript");
    }

    if ((!encodeType || encodeType === "json") && callback) {
      const json = JSON.stringify(payload);
      return textResponse(
        `;${callback}(${JSON.stringify(json)});`,
        "application/javascript",
      );
    }

    return new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        ...responseHeaders,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Hitokoto API error:", error);
    return handleError(500, error, env?.DEV_ENV);
  }
}
