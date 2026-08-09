// ============================================================================
// COMPONENTS: IMAGE UI — avatars everywhere (chat column, segment chips,
// sidebar rows, editors), the click-to-expand lightbox, and the square-crop
// editor behind Upload/Crop. Phase 2 of Images & avatars (v4.10).
// ============================================================================

// Round avatar: the image when `src` is set, otherwise a letter tile (first
// letter of the name) with the same name-hashed hue the speaker name gets —
// the tile keeps avatar columns aligned when someone has no image. Clickable
// (button semantics + pointer) only when onClick is passed.
function Avatar({ name = '', src = '', size = 40, onClick = null }) {
  const px = `${size}px`;
  const interactive = onClick ? {
    role: 'button', tabIndex: 0, onClick,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } },
  } : {};
  if (src) return html`<img class="avatar ${onClick ? 'click' : ''}" src=${src} alt=${name}
    style=${{ width: px, height: px }} ...${interactive} />`;
  const letter = (String(name).trim()[0] ?? '?').toUpperCase();
  return html`<span class="avatar avatar-tile ${onClick ? 'click' : ''}"
    style=${{ width: px, height: px, fontSize: `${Math.max(10, Math.round(size * 0.45))}px`, '--speaker-h': hueForName(String(name)) }}
    ...${interactive}>${letter}</span>`;
}

// Click-to-expand image view: a plain modal holding the image at natural size
// (capped to the viewport by CSS), caption underneath. Stacking, topmost-only
// Escape and mobile full-screen come from the existing modal CSS.
function Lightbox({ src, title = '', onClose }) {
  return html`
    <${Modal} title=${title || 'Image'} cls="lightbox" onClose=${onClose}>
      <img class="lb-img" src=${src} alt=${title} />
      ${title && html`<div class="lb-cap">${title}</div>`}
    <//>`;
}

// Square-crop editor for avatars. The image sits in an overflow-hidden square
// frame; pointer-drag pans, wheel + slider zoom (min zoom = the cover fit, so
// the image can never leave a gap). The view state is { F, scale, dx, dy }:
// F = the frame's CSS-px side, scale = displayed px per source px, dx/dy =
// the image's top-left offset from the frame's top-left (always ≤ 0). Confirm
// inverts that transform back to the source rect (sx = -dx/scale etc.) and
// hands the cropped 256px data URL to onDone.
function ImageCropper({ img, onDone, onClose }) {
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState(null); // null until the frame is measured
  const natW = img.naturalWidth || 1, natH = img.naturalHeight || 1;
  const minScaleFor = (F) => Math.max(F / natW, F / natH); // cover fit
  // Clamp scale to [cover, 4×cover] and offsets so the image always covers F.
  const clampView = (v) => {
    const minScale = minScaleFor(v.F);
    const scale = Math.min(Math.max(v.scale, minScale), minScale * 4);
    return { ...v, scale,
      dx: Math.min(0, Math.max(v.F - natW * scale, v.dx)),
      dy: Math.min(0, Math.max(v.F - natH * scale, v.dy)) };
  };
  // Measure once mounted (F is a layout fact), centering the cover fit.
  useLayoutEffect(() => {
    const F = frameRef.current?.clientWidth ?? 320;
    const s = minScaleFor(F);
    setView({ F, scale: s, dx: (F - natW * s) / 2, dy: (F - natH * s) / 2 });
  }, []);
  // Zoom keeping the frame CENTER fixed: offsets scale around C = F/2.
  const applyZoom = (v, target) => {
    const minScale = minScaleFor(v.F);
    const scale = Math.min(Math.max(target, minScale), minScale * 4);
    const k = scale / v.scale; // the factor actually applied after clamping
    const C = v.F / 2;
    return clampView({ ...v, scale, dx: C - (C - v.dx) * k, dy: C - (C - v.dy) * k });
  };
  const zoomBy = (factor) => setView(v => v && applyZoom(v, v.scale * factor));
  // React registers root wheel listeners as passive, so preventDefault needs a
  // native non-passive listener (or the page scrolls while zooming).
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015)); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const onPointerDown = (e) => {
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setDragging(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const mx = e.clientX - d.x, my = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY;
    setView(v => v && clampView({ ...v, dx: v.dx + mx, dy: v.dy + my }));
  };
  const endDrag = () => { dragRef.current = null; setDragging(false); };
  const confirm = () => {
    if (!view) return;
    const { F, scale, dx, dy } = view;
    const sx = Math.max(0, -dx / scale), sy = Math.max(0, -dy / scale);
    const sSize = Math.min(natW - sx, natH - sy, F / scale); // float-rounding guard
    onDone(cropSquareToDataURL(img, sx, sy, sSize, 256));
  };
  const minScale = view ? minScaleFor(view.F) : 1;
  return html`
    <${Modal} title="Crop avatar" cls="img-crop" onClose=${onClose}
      footer=${html`<button class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn primary" disabled=${!view} onClick=${confirm}>Use crop</button>`}>
      <div class="crop-frame ${dragging ? 'dragging' : ''}" ref=${frameRef}
        onPointerDown=${onPointerDown} onPointerMove=${onPointerMove}
        onPointerUp=${endDrag} onPointerCancel=${endDrag}>
        ${view && html`<img src=${img.src} alt="" draggable=${false} style=${{
          left: `${view.dx}px`, top: `${view.dy}px`,
          width: `${natW * view.scale}px`, height: `${natH * view.scale}px` }} />`}
      </div>
      <div class="crop-zoom">
        <span class="hint">Zoom</span>
        <input type="range" disabled=${!view} min=${minScale} max=${minScale * 4}
          step=${(minScale * 3) / 100} value=${view?.scale ?? minScale}
          onInput=${(e) => setView(v => v && applyZoom(v, Number(e.target.value)))} />
      </div>
    <//>`;
}

// The avatar editor row shared by the character/scenario/persona editors and
// character-type lore pieces (LorePieceFields): preview + Upload (file →
// cropper) / Crop (re-crop the current image) / ✦ (AI generate) / Clear.
// `set` applies a partial patch to the caller's
// draft; persistence stays with each editor's own Save. The ✦ button renders
// only when a caller passes onGenerateAvatar (Main: only while image
// generation is on) — it's invoked with the CURRENT draft's { name, content }
// (AvatarField owns draft freshness) and the resulting image opens in the
// cropper, exactly like an upload. Errors are the host's job: it banners
// them, we catch and only clear the busy state.
function AvatarField({ draft, set, onGenerateAvatar = null }) {
  // The image in the cropper plus the full-res companion its crop confirms
  // into the draft: full = the ≤1024 uncropped source (Upload/✦ refresh
  // avatarFull alongside the thumb); full = null on a re-crop — the stored
  // full copy is unchanged, only the 256² thumb is rewritten.
  const [cropImg, setCropImg] = useState(null); // { img, full } | null
  const [genBusy, setGenBusy] = useState(false); // ✦ generation in flight
  // Character/scenario/persona drafts carry `name`; a character-type lore
  // piece's display name is its `title`.
  const draftName = draft.name ?? draft.title ?? '';
  const upload = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const img = await loadImageFromFile(file);
      // Work from a data-URL copy: the picker's object URL is revoked on load
      // (the cropper couldn't re-display it), and a capped copy keeps the crop
      // pipeline fast no matter how big the original is. The same ≤1024 copy
      // lands on avatarFull at crop confirm — the uncropped expand-view source.
      const src = downscaleImageToDataURL(img, 1024);
      const work = new Image();
      work.onload = () => setCropImg({ img: work, full: src });
      work.onerror = () => console.warn('avatar: could not reload the working copy');
      work.src = src;
    } catch (e) { console.warn('avatar: could not decode image file', e); }
  };
  const recrop = () => {
    const img = new Image();
    img.onload = () => setCropImg({ img, full: null });
    img.src = draft.avatarFull || draft.avatar; // re-crop from the full copy when one exists
  };
  // ✦: hand the host the live draft (a character card's .content; otherwise
  // persona/scenario .description + scenario .backstory), then crop the
  // generated portrait like an upload. The ≤1024 generation lands on
  // avatarFull at crop confirm, exactly like an upload's working copy.
  const generate = async () => {
    setGenBusy(true);
    try {
      const content = draft.content ?? [draft.description, draft.backstory].filter(s => (s ?? '').trim()).join('\n\n');
      const src = await onGenerateAvatar({ name: draftName, content });
      const img = new Image();
      img.onload = () => setCropImg({ img, full: src });
      img.src = src;
    } catch { /* the host banners the error */ }
    finally { setGenBusy(false); }
  };
  return html`
    <${React.Fragment}>
    <div class="field"><span>Avatar — shown beside chat bubbles and in sidebar lists; square-cropped to 256px</span>
      <div style=${{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <${Avatar} name=${draftName} src=${draft.avatar ?? ''} size=${48} />
        <button class="btn small" onClick=${upload}>Upload</button>
        ${draft.avatar && html`<button class="btn small" title="Re-crop the current image" onClick=${recrop}>Crop</button>`}
        ${onGenerateAvatar && html`<button class="btn small" disabled=${genBusy}
          title="Generate an avatar with the AI — the current draft becomes a portrait, then you crop it"
          onClick=${generate}>${genBusy ? '…' : '✦'}</button>`}
        ${draft.avatar && html`<button class="btn small" onClick=${() => set({ avatar: '', avatarFull: '' })}>Clear</button>`}
      </div>
    </div>
    ${cropImg && html`<${ImageCropper} img=${cropImg.img} onClose=${() => setCropImg(null)}
      onDone=${(dataURL) => { set(cropImg.full == null ? { avatar: dataURL } : { avatar: dataURL, avatarFull: cropImg.full }); setCropImg(null); }} />`}
    <//>`;
}
