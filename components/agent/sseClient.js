// SSE (Server-Sent Events) client for React Native.
//
// Why XMLHttpRequest and not fetch + ReadableStream?
// React Native's fetch implementation does NOT expose `response.body.getReader()` —
// the body comes back as a Blob or null on RN < 0.78 / Hermes < 0.12, so any code
// path that calls `body.getReader()` throws "Streaming not supported in this
// environment" (which is exactly what was happening). XHR's `onprogress` callback,
// on the other hand, is the canonical streaming mechanism in React Native — it
// fires every time new bytes arrive, and `xhr.responseText` is the full
// accumulated body. This module reads deltas by tracking `lastIndex`.
//
// SSE wire format (per https://html.spec.whatwg.org/multipage/server-sent-events.html):
//   event: <name>\n
//   data: <json or text>\n
//   \n                       <- blank line ends the event
//
// Multi-line `data:` fields are concatenated. CRLF is normalized to LF.

/**
 * Open a streaming request and parse the SSE response into typed events.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {string} [opts.method='GET']
 * @param {object} [opts.headers={}]
 * @param {object|string|null} [opts.body=null]  object → JSON.stringify
 * @param {number} [opts.timeoutMs=180000]
 * @param {function} onEvent  (eventName, data) => void
 * @returns {Promise<void>}  resolves when the stream ends (done/error/normal close)
 * @throws on network error or non-2xx status
 */
export function streamSSE(url, opts = {}, onEvent) {
  return new Promise((resolve, reject) => {
    if (typeof onEvent !== 'function') {
      reject(new Error('streamSSE requires an onEvent callback'));
      return;
    }

    const xhr = new XMLHttpRequest();
    const { method = 'GET', headers = {}, body = null, timeoutMs = 180000 } = opts;

    xhr.open(method, url, true);

    // Set request headers. Some headers (Host, Content-Length, etc.) are
    // managed by the platform and will throw if we try to set them — swallow.
    Object.entries(headers).forEach(([k, v]) => {
      try {
        xhr.setRequestHeader(k, String(v));
      } catch (_) {
        // ignore
      }
    });

    let lastIndex = 0;
    let buffer = '';
    let settled = false;

    const settle = (err) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    // Fired every time new data arrives. xhr.responseText contains the FULL
    // accumulated body — we slice off what we haven't seen yet.
    xhr.onprogress = () => {
      const full = xhr.responseText || '';
      if (full.length <= lastIndex) return;

      const newChunk = full.substring(lastIndex);
      lastIndex = full.length;
      buffer += newChunk;
      buffer = buffer.replace(/\r\n/g, '\n');

      // Drain complete events (blank-line delimited).
      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseEventBlock(raw);
        if (parsed) {
          try { onEvent(parsed.event, parsed.data); } catch (_) { /* swallow */ }
          if (parsed.event === 'done' || parsed.event === 'error') {
            try { xhr.abort(); } catch (_) {}
            settle();
            return;
          }
        }
      }
    };

    xhr.onload = () => {
      // Flush any remaining partial event.
      if (buffer.trim()) {
        const parsed = parseEventBlock(buffer);
        if (parsed) {
          try { onEvent(parsed.event, parsed.data); } catch (_) {}
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        settle();
      } else {
        onEvent('error', { message: `HTTP ${xhr.status}: ${(xhr.responseText || '').slice(0, 200)}` });
        settle(new Error(`HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => {
      try { onEvent('error', { message: 'Network error (xhr.onerror)' }); } catch (_) {}
      settle(new Error('Network error'));
    };

    xhr.ontimeout = () => {
      try { onEvent('error', { message: `Request timeout after ${timeoutMs}ms` }); } catch (_) {}
      settle(new Error('Request timeout'));
    };

    xhr.onabort = () => {
      // abort 在 React Native XHR 上是个**不可靠的信号**，区分不开三种来源：
      //   1) 收到 'done'/'error' 后我们主动 xhr.abort() —— 设计内行为
      //   2) 服务端 res.end() 后 RN 平台 emit abort 作为 socket 清理 —— 流已正常结束
      //   3) 真网络中断 —— 用户已看到部分输出
      // 三种情况都视为"流结束"，settle 即可。
      // 如果是 (3) 的真中断，UI 会看到流停在某处 —— 比误报"连接已中断"更诚实。
      if (!settled) settle();
    };

    xhr.timeout = timeoutMs;

    if (body == null) {
      xhr.send();
    } else if (typeof body === 'string') {
      xhr.send(body);
    } else {
      xhr.send(JSON.stringify(body));
    }
  });
}

function parseEventBlock(block) {
  let event = 'message';
  const dataParts = [];
  const lines = block.split('\n');

  for (const rawLine of lines) {
    if (!rawLine) continue;
    if (rawLine.startsWith(':')) continue;  // SSE comment

    const colon = rawLine.indexOf(':');
    if (colon === -1) {
      if (rawLine === 'event') event = '';
      else if (rawLine === 'data') dataParts.push('');
      continue;
    }

    const field = rawLine.slice(0, colon);
    let value = rawLine.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);  // spec: strip exactly one leading space

    if (field === 'event') event = value;
    else if (field === 'data') dataParts.push(value);
    // 'id' and 'retry' intentionally ignored
  }

  if (dataParts.length === 0) return null;

  const joined = dataParts.join('\n');
  let data;
  try {
    data = JSON.parse(joined);
  } catch (_) {
    data = joined;
  }
  return { event: event || 'message', data };
}
