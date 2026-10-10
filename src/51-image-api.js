// ============================================================================
// IMAGE BACKENDS — OpenAI-compatible /v1/images/generations and the ComfyUI
// queue → poll → download REST flow (split out of 50-api.js; shares its
// fetchAPI/authHeaders/apiHttpError helpers via the concatenated scope).
// ============================================================================
const imagesURL = (ep) => `${normalizeEndpoint(ep)}/v1/images/generations`;
// ComfyUI REST (backend 'comfyui'): queue → poll → download.
const comfyPromptURL = (ep) => `${normalizeEndpoint(ep)}/prompt`;
const comfyHistoryURL = (ep, id) => `${normalizeEndpoint(ep)}/history/${encodeURIComponent(id)}`;
const comfyViewURL = (ep, img) => `${normalizeEndpoint(ep)}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${encodeURIComponent(img.type ?? 'output')}`;

// ---- /images/generations (OpenAI-compatible; /image command) ----
// One image per call, returned as a data URL at the backend's native
// resolution and format — no downscale, no re-encode: imageSize is the
// user's explicit size control, so a 960x1440 PNG render stays exactly that.
// b64_json is the primary shape; a url response is fetched and converted
// (through our own /proxy when the request went through it, so an absolute
// image URL on a CORS-less host still loads). The LLM key is never sent on
// the url fetch — image CDNs don't need it and it must not leak off-origin.
async function generateImage({ endpoint, apiKey, serverToken, model, prompt, size, signal, prefix = '', backend = 'openai', workflow = '', negative = '' }) {
  if (backend === 'comfyui')
    return generateComfyImage({ endpoint, apiKey, serverToken, workflow, prompt, negative, size, signal, prefix });
  const res = await fetchAPI(endpoint, imagesURL(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
    ...(signal ? { signal } : {}),
    body: JSON.stringify({
      prompt: imagePromptWithPrefix(prefix, prompt),
      ...(model ? { model } : {}),
      ...(size ? { size } : {}),
      response_format: 'b64_json',
    }),
  });
  if (!res.ok) throw await apiHttpError(res);
  const json = await res.json();
  if (json?.error?.message) throw new Error(json.error.message);
  const item = json?.data?.[0];
  let dataURL;
  if (item?.b64_json) {
    dataURL = `data:image/png;base64,${item.b64_json}`;
  } else if (item?.url) {
    // The proxy target is the part after /proxy/; the image fetch reuses that
    // shape with the image URL as the target (server.mjs decodes it whole).
    const u = String(item.url);
    const proxied = isServerProxy(endpoint) && /^https?:\/\//i.test(u) ? `/proxy/${u}` : u;
    const imgRes = await fetchAPI(endpoint, proxied, {
      headers: { ...(serverToken && isServerProxy(endpoint) ? { 'Authorization': `Bearer ${serverToken}` } : {}) },
      ...(signal ? { signal } : {}),
    });
    if (!imgRes.ok) {
      const err = new Error(`image fetch failed (HTTP ${imgRes.status})`);
      err.status = imgRes.status;
      throw err;
    }
    const blob = await imgRes.blob();
    dataURL = await blobToDataURL(blob);
  } else {
    throw new Error('Malformed images response — no b64_json or url in data[0]');
  }
  return dataURL;
}

const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result));
  fr.onerror = () => reject(new Error('could not read the image response'));
  fr.readAsDataURL(blob);
});

// ---- ComfyUI backend (settings.imageBackend === 'comfyui') ----
// Queue the substituted workflow, poll /history until the run lands, then
// download the first output image from /view. Same native-resolution
// data-URL contract as the OpenAI path (no downscale, no re-encode).
// ComfyUI answers identical graphs from its cache, so the
// history is checked BEFORE the first sleep — a cached run returns at once.
// The workflow comes from settings.imageWorkflow (web UI "Save (API Format)"
// export); substitution + seed rules live in substituteComfyWorkflow (core).
async function generateComfyImage({ endpoint, apiKey, serverToken, workflow, prompt, negative, size, signal, prefix = '', timeoutMs = 300000 }) {
  let graph;
  try { graph = JSON.parse(String(workflow ?? '')); } catch {
    throw new Error('The ComfyUI workflow in Settings is not valid JSON — paste the "Save (API Format)" export.');
  }
  const { width, height } = parseImageSize(size);
  const payload = substituteComfyWorkflow(graph, {
    prompt: imagePromptWithPrefix(prefix, prompt), negative, width, height });
  const headers = { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) };
  const res = await fetchAPI(endpoint, comfyPromptURL(endpoint), {
    method: 'POST', headers, ...(signal ? { signal } : {}),
    body: JSON.stringify({ prompt: payload }),
  });
  if (!res.ok) throw await apiHttpError(res);
  const queued = await res.json();
  const promptId = queued?.prompt_id;
  if (!promptId) throw new Error('ComfyUI did not return a prompt_id — is this a ComfyUI server?');
  const deadline = Date.now() + timeoutMs;
  const sleep = (ms) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason ?? new Error('aborted')); }, { once: true });
  });
  for (;;) {
    const hRes = await fetchAPI(endpoint, comfyHistoryURL(endpoint, promptId), {
      headers: { ...authHeaders(apiKey, endpoint, serverToken) }, ...(signal ? { signal } : {}) });
    if (!hRes.ok) {
      const err = new Error(`HTTP ${hRes.status}`);
      err.status = hRes.status;
      throw err;
    }
    const result = comfyHistoryResult(await hRes.json(), promptId);
    if (result.error) throw new Error(result.error);
    if (result.done && result.image) {
      // /view authenticates exactly like /prompt above (the configured image
      // key belongs to this host; through our proxy it maps as usual).
      const imgRes = await fetchAPI(endpoint, comfyViewURL(endpoint, result.image), {
        headers: { ...authHeaders(apiKey, endpoint, serverToken) }, ...(signal ? { signal } : {}) });
      if (!imgRes.ok) {
        const err = new Error(`image fetch failed (HTTP ${imgRes.status})`);
        err.status = imgRes.status;
        throw err;
      }
      return blobToDataURL(await imgRes.blob());
    }
    if (Date.now() > deadline) throw new Error('ComfyUI timed out — the run never landed in history');
    await sleep(1500);
  }
}
