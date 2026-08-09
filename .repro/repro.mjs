// General SSR/streaming regression harness for fictionpad.html.
// Extracts the app's module script, neutralizes the browser boot line, exports
// the internals, and imports them in Node. Trials cover: Context Inspector
// preview + SSR render (incl. hostile data shapes), message/prose markdown
// rendering (dialogue pairing, streaming auto-close), settings/sidebar/editor
// SSR smoke, ProbsView, branch-panel outline condensation (fork appearance,
// growth, active-highlight jumps, swipe tags), the openaiChatStream normalizer
// (content/lp split, logit_bias, choices-less chunks), alignTokensToSpans / alignStrippedToolSpans
// tiling, tokenize/embed parsing, and proxy auth-header mapping. Any throw
// fails the trial; run `node .repro/repro.mjs` (deps: npm install in .repro/).
import { readFileSync, writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';

let src = readFileSync(new URL('../fictionpad.html', import.meta.url), 'utf8');
src = src.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
// Neutralize the browser boot line; export what we need instead.
src = src.replace(/createRoot\(document\.getElementById\('root'\)\)\.render[\s\S]*$/, `
export { ContextInspector, MessageItem, Markdown, assemblePrompt, ProbsView,
  openaiChatStream, alignTokensToSpans, alignStrippedToolSpans, stripToolBlocksMapped, tokenize, getTokenCount, embed, embedCached, cosine, SEMANTIC_THRESHOLD,
  effectiveEndpoint, roleConn, html, SettingsModal, DEFAULT_SETTINGS,
  Sidebar, CharacterEditor, ScenarioEditor, NewChatModal, LORE_TEMPLATES, newLoreFromTemplate,
  LorePieceEditor, chatSearchText, matchExcerpt,
  Avatar, Lightbox, AvatarField,
  BranchPanel, appendMessage, activateBranch, getActivePath,
  splitImageCalls, IMAGE_CALL_CAP, DEFAULT_IMAGE_PROMPT, DEFAULT_AVATAR_GEN_PROMPT,
  substituteComfyWorkflow, comfyHistoryResult, parseImageSize, comfyRandomSeed,
  buildCharacterCard, embedPngCardJson, pngCrc32 };`);
writeFileSync(new URL('./fp-module.mjs', import.meta.url), src);

const fp = await import('./fp-module.mjs');
const { ContextInspector, MessageItem, Markdown, assemblePrompt, html } = fp;

const node = (id, parentId, role, text, createdAt = 1) => ({
  id, parentId, role, activeSwipe: 0, edited: false,
  swipes: [{ text, createdAt, modelId: 'test-model' }],
});

function makeFixture(overrides = {}) {
  const scenario = {
    id: 'S', name: 'Veyra', description: '', tags: [],
    backstory: 'A floating city.', greeting: 'Welcome, {{user}}.',
    scenarioInstructions: 'Second person.',
    lorePieces: [
      { id: 'L1', type: 'character', title: 'Vex', content: 'A smuggler.', keys: ['vex'], pinned: true, weight: 1, links: [], enabled: true, searchDepth: null },
      { id: 'L2', type: 'lore', title: 'Docks', content: 'Sky docks.', keys: ['dock'], pinned: false, weight: 0, links: ['L1'], enabled: true, searchDepth: null },
    ],
    ...overrides.scenario,
  };
  const persona = { id: 'P', name: 'Ari', description: 'a courier' };
  const chat = {
    id: 'C', scenarioId: 'S', personaId: 'P', customInstructions: '',
    rootMessageId: 'root', activeLeafId: 'a1',
    messages: {
      root: node('root', null, 'assistant', 'Welcome, {{user}}.'),
      u1: node('u1', 'root', 'user', 'I head to the dock.'),
      a1: node('a1', 'u1', 'assistant', '*Vex grins.* "About time."'),
    },
    memoryStore: { memories: [
      { id: 'memA1', text: 'Ari owes Vex money.', pinned: true, createdAt: 1 },
      { id: 'memB2', text: 'The crew left.', pinned: false, createdAt: 2 },
    ], cursor: 0 },
    ...overrides.chat,
  };
  const settings = { contextLength: 8192, maxTokens: 400, responseLength: 'medium', samplers: {} };
  return { scenario, persona, chat, settings, platformPrompt: 'RP prompt.' };
}

let failures = 0;
const trials = [];
function trial(name, fn) { trials.push([name, fn]); }

// The exact onPreview path, then render the inspector with the result.
function previewAndRender(fixture) {
  const { manifest } = assemblePrompt(fixture); // == onPreview body (post-fix)
  return renderToStaticMarkup(
    html`<${ContextInspector} manifest=${manifest} hasChat=${true} onPreview=${() => {}} />`);
}

trial('preview + inspector render (healthy data)', () => previewAndRender(makeFixture()));

// Regression: the pre-fix bug stored the whole {messages, manifest} result in
// state. The inspector must now degrade to the empty state instead of throwing.
trial('wrong-shape manifest (bug-1 regression) is guarded', () => {
  const wrongShape = assemblePrompt(makeFixture());
  const out = renderToStaticMarkup(
    html`<${ContextInspector} manifest=${wrongShape} hasChat=${true} onPreview=${() => {}} />`);
  if (!out.includes('No generation recorded yet')) throw new Error('guard did not render empty state');
});

// Hostile variants — old/imported/hand-edited data shapes:
trial('memory without id', () => previewAndRender(makeFixture({
  chat: { memoryStore: { memories: [{ text: 'no id', pinned: false, createdAt: 1 }], cursor: 0 } },
})));
trial('lore piece without id/title', () => previewAndRender(makeFixture({
  scenario: { lorePieces: [{ type: 'lore', content: 'x', keys: ['dock'], pinned: true, weight: 0, links: [], enabled: true }] },
})));
trial('memoryStore.memories not an array', () => previewAndRender(makeFixture({
  chat: { memoryStore: { memories: { id: 'x' }, cursor: 0 } },
})));
trial('lore keys as string', () => previewAndRender(makeFixture({
  scenario: { lorePieces: [{ id: 'L9', type: 'lore', title: 'T', content: 'x', keys: 'dock', pinned: false, weight: 0, links: [], enabled: true }] },
})));
trial('chat with no messages (empty tree)', () => previewAndRender(makeFixture({
  chat: { messages: {}, activeLeafId: null, rootMessageId: null },
})));
trial('missing scenario (imported chat)', () => {
  const f = makeFixture();
  f.scenario = undefined;
  previewAndRender(f);
});
trial('settings.responseLength unknown key', () => {
  const f = makeFixture();
  f.settings.responseLength = 'huge';
  previewAndRender(f);
});

// Also render the chat pane messages (assistant prose markdown) for good measure.
trial('message list render incl. prose markdown', () => {
  const f = makeFixture();
  renderToStaticMarkup(html`
    <${MessageItem} node=${f.chat.messages.a1} isRoot=${false} personaName="Ari"
      characterNames=${['Vex']} streaming=${false} generating=${false}
      onEdit=${() => {}} onRegenerate=${() => {}} onSwipe=${() => {}}
      onBranch=${() => {}} onRewind=${() => {}} onDelete=${() => {}} onReply=${() => {}} />`);
});

// Settings modal smoke: tabbed categories render with realistic defaults.
trial('settings modal renders tab bar + appearance tab (SSR smoke)', () => {
  const out = renderToStaticMarkup(html`
    <${fp.SettingsModal} settings=${fp.DEFAULT_SETTINGS} onSave=${() => {}} onClose=${() => {}}
      theme="ctp-mocha" onThemeChange=${() => {}} accent="mauve" onAccentChange=${() => {}}
      onOpenLogitBias=${() => {}} storageKind="local"
      onUpload=${async () => 0} onDownload=${async () => 0} />`);
  for (const label of ['Appearance', 'Connection', 'Models', 'Generation', 'Features', 'Prompts'])
    if (!out.includes(label)) throw new Error(`missing settings tab: ${label}`);
});

// Tab scoping regression: a section appended after a tab's html` close renders
// on EVERY tab. Role connections must show only on Connection.
trial('settings: Role connections section is scoped to the Connection tab', () => {
  const render = (initialTab) => renderToStaticMarkup(html`
    <${fp.SettingsModal} settings=${{ ...fp.DEFAULT_SETTINGS, imagesEnabled: true }} onSave=${() => {}} onClose=${() => {}}
      theme="ctp-mocha" onThemeChange=${() => {}} accent="mauve" onAccentChange=${() => {}}
      onOpenLogitBias=${() => {}} storageKind="local" initialTab=${initialTab}
      onUpload=${async () => 0} onDownload=${async () => 0} />`);
  const appearance = render('appearance');
  if (appearance.includes('Role connections')) throw new Error('leaked onto the appearance tab');
  if (appearance.includes('Test connection')) throw new Error('API connection leaked onto the appearance tab');
  const connection = render('connection');
  if (!connection.includes('Role connections')) throw new Error('missing on the connection tab');
  if (!connection.includes('Aux endpoint') || !connection.includes('Images API key'))
    throw new Error('role pairs missing on the connection tab');
  const features = render('features');
  if (features.includes('Role connections')) throw new Error('leaked onto the features tab');
  if (!features.includes('Prompt prefix')) throw new Error('image section missing on the features tab');
  if (features.includes('Image endpoint')) throw new Error('image endpoint should live in Connection, not Features');
  const models = render('models');
  if (models.includes('Role connections')) throw new Error('leaked onto the models tab');
  if (!models.includes('Image model')) throw new Error('image model missing on the models tab');
});

// Smoke: the sidebar's Characters section, and collapsed sections pinning
// the open chat's related entries (its scenario, linked characters, the chat).
trial('sidebar renders characters + collapsed sections pin open-chat entries (SSR smoke)', () => {
  const noop = () => {};
  const characters = { CH1: { id: 'CH1', name: 'Mira', content: 'x', keys: [], enabled: true } };
  const scenarios = { S: { id: 'S', name: 'Veyra', characterIds: ['CH1'], lorePieces: [] } };
  const chats = { C: { id: 'C', scenarioId: 'S', name: 'Veyra — 01/01/2026', createdAt: 1 } };
  const out = renderToStaticMarkup(html`
    <${fp.Sidebar} scenarios=${scenarios} chats=${chats} characters=${characters}
      selectedScenarioId=${null} selectedCharacterId=${null} selectedChatId=${'C'}
      onSelectScenario=${noop} onSelectCharacter=${noop} onSelectChat=${noop}
      onNewScenario=${noop} onEditScenario=${noop} onDeleteScenario=${noop} onNewChat=${noop}
      onNewCharacter=${noop} onEditCharacter=${noop} onDeleteCharacter=${noop} onNewCharacterChat=${noop}
      onExportScenario=${noop} onExportCharacter=${noop} onImport=${noop}
      onOpenPersonas=${noop} onOpenSettings=${noop} collapsed=${false} onToggleCollapse=${noop}
      onDeleteChat=${noop} sideCollapsed=${{ scenarios: true, characters: true, chats: true }}
      onToggleSection=${noop} storageKind="local" saveRetrying=${false}
      width=${300} onDragStart=${noop} onResetWidth=${noop} onChatAction=${noop} onChatContextMenu=${noop} />`);
  if (!out.includes('Characters')) throw new Error('characters section missing: ' + out);
  // All three sections collapsed → only the open chat's scenario, its linked
  // character, and the chat itself stay visible.
  if (!out.includes('Veyra')) throw new Error('pinned scenario missing: ' + out);
  if (!out.includes('Mira')) throw new Error('pinned linked character missing: ' + out);
});

// Smoke: the Chats section filter input renders; with an empty filter the
// chat list is exactly the old behavior (here: collapsed → pinned open chat).
trial('sidebar chat filter input renders, empty filter keeps pinned view (SSR smoke)', () => {
  const noop = () => {};
  const scenarios = { S: { id: 'S', name: 'Veyra', characterIds: [], lorePieces: [] } };
  const chats = {
    C1: { id: 'C1', scenarioId: 'S', name: 'Alpha run', createdAt: 1 },
    C2: { id: 'C2', scenarioId: 'S', name: 'Beta run', createdAt: 2 },
  };
  const out = renderToStaticMarkup(html`
    <${fp.Sidebar} scenarios=${scenarios} chats=${chats} characters=${{}}
      selectedScenarioId=${null} selectedCharacterId=${null} selectedChatId=${'C1'}
      onSelectScenario=${noop} onSelectCharacter=${noop} onSelectChat=${noop}
      onNewScenario=${noop} onEditScenario=${noop} onDeleteScenario=${noop} onNewChat=${noop}
      onNewCharacter=${noop} onEditCharacter=${noop} onDeleteCharacter=${noop} onNewCharacterChat=${noop}
      onExportScenario=${noop} onExportCharacter=${noop} onImport=${noop}
      onOpenPersonas=${noop} onOpenSettings=${noop} collapsed=${false} onToggleCollapse=${noop}
      onDeleteChat=${noop} sideCollapsed=${{ scenarios: false, characters: false, chats: true }}
      onToggleSection=${noop} storageKind="local" saveRetrying=${false}
      width=${300} onDragStart=${noop} onResetWidth=${noop} onChatAction=${noop} onChatContextMenu=${noop} />`);
  if (!out.includes('Search…')) throw new Error('filter input missing: ' + out);
  // Chats section collapsed + empty filter → only the open chat pinned.
  if (!out.includes('Alpha run')) throw new Error('pinned open chat missing: ' + out);
  if (out.includes('Beta run')) throw new Error('empty filter must respect collapse: ' + out);
});

// Full-text chat search helpers: the haystack covers every swipe of every
// node, the cache key tracks updatedAt, and excerpts give one-line context.
trial('chat search: haystack spans all swipes, cache keys on updatedAt, excerpt context', () => {
  const chat = {
    id: 'C1', updatedAt: 7,
    messages: {
      root: { id: 'root', parentId: null, swipes: [{ text: 'Welcome to the docks.' }] },
      u1: { id: 'u1', parentId: 'root', swipes: [{ text: 'first take' }, { text: 'I bribe the harbormaster.' }] },
    },
  };
  const { raw, lower } = fp.chatSearchText(chat);
  if (!lower.includes('harbormaster')) throw new Error('inactive swipe text missing from haystack: ' + raw);
  if (lower !== raw.toLowerCase()) throw new Error('lowercase copy diverged');
  // Same id + updatedAt → cached (same object); bumped updatedAt → rebuilt.
  if (fp.chatSearchText(chat) !== fp.chatSearchText(chat)) throw new Error('cache did not memoize');
  const excerpt = fp.matchExcerpt(raw, lower.indexOf('harbormaster'), 'harbormaster'.length);
  if (!excerpt.includes('harbormaster') || excerpt.includes('\n')) throw new Error('bad excerpt: ' + excerpt);
  const long = fp.matchExcerpt('x'.repeat(500), 250, 1);
  if (!long.startsWith('…') || !long.endsWith('…')) throw new Error('mid-text excerpt not ellipsized: ' + long);
});

// Smoke: character editor, scenario-editor link section, and the
// direct-character new-chat modal.
trial('character editor + scenario editor + character new-chat modal render (SSR smoke)', () => {
  const noop = () => {};
  const characters = { CH1: { id: 'CH1', name: 'Mira', content: 'card', keys: [], enabled: true, greeting: 'Hi.' } };
  const scenarios = { S: { id: 'S', name: 'Veyra', characterIds: ['CH1'], lorePieces: [] } };
  const mgr = renderToStaticMarkup(html`
    <${fp.CharacterEditor} character=${characters.CH1} scenarios=${scenarios}
      onUpsert=${noop} onClose=${noop} />`);
  if (!mgr.includes('Linked into 1 scenario')) throw new Error('link count missing: ' + mgr);
  const ed = renderToStaticMarkup(html`
    <${fp.ScenarioEditor} scenario=${scenarios.S} characters=${characters} onSave=${noop} onClose=${noop} />`);
  if (!ed.includes('Linked characters')) throw new Error('link section missing: ' + ed);
  const nc = renderToStaticMarkup(html`
    <${fp.NewChatModal} scenario=${null} character=${characters.CH1} personas=${{}}
      onCreate=${noop} onClose=${noop} />`);
  if (!nc.includes('Direct chat with Mira')) throw new Error('character new-chat hint missing: ' + nc);
});

// Lore quick-add templates: buttons render in the scenario editor and each
// skeleton yields a well-formed piece (type set, keys empty, hook line first).
trial('lore templates: buttons render + skeletons are well-formed', () => {
  const noop = () => {};
  const ed = renderToStaticMarkup(html`
    <${fp.ScenarioEditor} scenario=${{ id: 'S', name: 'Veyra', lorePieces: [] }}
      characters=${{}} onSave=${noop} onClose=${noop} />`);
  for (const t of fp.LORE_TEMPLATES)
    if (!ed.includes(`>+ ${t.label}<`)) throw new Error(`template button missing: ${t.label}`);
  const byLabel = Object.fromEntries(fp.LORE_TEMPLATES.map(t => [t.label, fp.newLoreFromTemplate(t)]));
  if (byLabel.character.type !== 'character') throw new Error('character template type wrong');
  for (const label of ['location', 'faction', 'item'])
    if (byLabel[label].type !== 'lore') throw new Error(`${label} template type wrong`);
  for (const [label, p] of Object.entries(byLabel)) {
    if (!p.id || !p.content.includes('— one-line hook.')) throw new Error(`${label} skeleton malformed`);
    if (!Array.isArray(p.keys) || p.keys.length) throw new Error(`${label} keys should be empty`);
    if (p.title !== '') throw new Error(`${label} title should be empty`);
  }
});

// Lore piece editor popout (chat options): all fields visible, ✦ Generate +
// Save in the footer, links in a RailScroll list; a blank title disables Save.
trial('lore piece editor popout renders fields + footer (SSR smoke)', () => {
  const noop = () => {};
  const pieces = [
    { id: 'L1', type: 'character', title: 'Vex', content: 'A smuggler.', keys: ['vex'], pinned: true, weight: 1, links: ['L2'], enabled: true },
    { id: 'L2', type: 'lore', title: 'Docks', content: 'Sky docks.', keys: ['dock'], pinned: false, weight: 0, links: [], enabled: true },
  ];
  const out = renderToStaticMarkup(html`
    <${fp.LorePieceEditor} piece=${pieces[0]} isNew=${false} allPieces=${pieces}
      onSave=${noop} onClose=${noop} onGenerate=${async () => ({})} />`);
  for (const frag of ['Lore — Vex', '✦ Generate', 'Save', 'Links', 'rail-body links-list', 'Docks'])
    if (!out.includes(frag)) throw new Error(`missing ${frag}: ` + out);
  const fresh = renderToStaticMarkup(html`
    <${fp.LorePieceEditor} piece=${{ id: 'L9', type: 'lore', title: '', content: '', keys: [], links: [] }}
      isNew=${true} allPieces=${pieces} onSave=${noop} onClose=${noop} onGenerate=${noop} />`);
  if (!fresh.includes('New lore piece')) throw new Error('new-piece title missing: ' + fresh);
  if (!fresh.match(/<button[^>]*disabled[^>]*>Save</)) throw new Error('blank title should disable Save: ' + fresh);
});

// Regression: `Mia:\n*actions here*` — the prefix strip must not cross the
// newline and eat the action's opening star (leaves `actions here*` unpaired).
trial('speaker prefix strip keeps action stars across a newline', () => {
  const out = renderToStaticMarkup(html`
    <${MessageItem} node=${node('x1', null, 'assistant', 'Mia:\n*actions here*')}
      isRoot=${false} personaName="Ari" characterNames=${['Mia']}
      streaming=${false} generating=${false}
      onEdit=${() => {}} onRegenerate=${() => {}} onSwipe=${() => {}}
      onBranch=${() => {}} onRewind=${() => {}} onDelete=${() => {}} onReply=${() => {}} />`);
  if (!out.includes('<em>actions here</em>')) throw new Error('action em eaten by prefix strip: ' + out);
  if (out.includes('Mia:')) throw new Error('speaker prefix not stripped: ' + out);
});

// Multi-speaker swipe: the header names everyone who spoke, in order.
trial('multi-speaker header lists all speakers in order', () => {
  const out = renderToStaticMarkup(html`
    <${MessageItem} node=${node('x2', null, 'assistant', 'Mia: "Hi."\n\nNarrator: *Narration happens.*\n\nSamantha: "Hey."')}
      isRoot=${false} personaName="Ari" characterNames=${['Mia', 'Samantha']}
      streaming=${false} generating=${false}
      onEdit=${() => {}} onRegenerate=${() => {}} onSwipe=${() => {}}
      onBranch=${() => {}} onRewind=${() => {}} onDelete=${() => {}} onReply=${() => {}} />`);
  const meta = out.match(/<div class="meta[^"]*"[\s\S]*?<\/div>/)?.[0] ?? '';
  const mi = meta.indexOf('>Mia<'), ni = meta.indexOf('>Narrator<'), si = meta.indexOf('>Samantha<');
  if (mi < 0 || ni < 0 || si < 0) throw new Error('header missing a speaker: ' + meta);
  if (!(mi < ni && ni < si)) throw new Error('speakers out of order: ' + meta);
});

// Avatars (v4.10 phase 2): the bubble column renders an <img> when the map
// has the speaker, a letter tile only for a NAMED character on a miss — an
// imageless user or Narrator gets the bare (empty) .msg-av slot, never a
// tile; avatarsOn=false renders nothing.
// Map entries are { src, full } — the column/chips render the 256² thumb
// (src); the uncropped companion (full) feeds only the click lightbox.
trial('avatars: column shows image avatar, letter tile on miss, nothing when off', () => {
  const cb = { onEdit: () => {}, onRegenerate: () => {}, onSwipe: () => {},
    onBranch: () => {}, onRewind: () => {}, onDelete: () => {}, onReply: () => {} };
  const img = renderToStaticMarkup(html`
    <${MessageItem} node=${node('av1', null, 'assistant', 'Vex: "Hi."')}
      isRoot=${false} personaName="Ari" characterNames=${['Vex']}
      avatars=${{ vex: { src: 'data:image/webp;base64,AAAA', full: 'data:image/webp;base64,FFFF' } }} avatarsOn=${true}
      streaming=${false} generating=${false} ...${cb} />`);
  if (!img.includes('with-av')) throw new Error('avatar column class missing: ' + img);
  if (!img.includes('<img')) throw new Error('image avatar not rendered: ' + img);
  // A full≠src entry still renders the THUMB in the column — the full copy is
  // lightbox-only (SSR can't click, so the full URL must not appear at all).
  if (!img.includes('src="data:image/webp;base64,AAAA"')) throw new Error('column should render the thumb src: ' + img);
  if (img.includes('FFFF')) throw new Error('the full-res companion must stay out of the column markup: ' + img);
  const tile = renderToStaticMarkup(html`
    <${MessageItem} node=${node('av2', null, 'assistant', 'Vex: "Hi."')}
      isRoot=${false} personaName="Ari" characterNames=${['Vex']}
      avatars=${{}} avatarsOn=${true}
      streaming=${false} generating=${false} ...${cb} />`);
  if (!tile.includes('avatar-tile') || !tile.includes('>V<')) throw new Error('letter tile not rendered: ' + tile);
  const off = renderToStaticMarkup(html`
    <${MessageItem} node=${node('av3', null, 'assistant', 'Vex: "Hi."')}
      isRoot=${false} personaName="Ari" characterNames=${['Vex']}
      avatars=${{ vex: { src: 'data:image/webp;base64,AAAA', full: 'data:image/webp;base64,AAAA' } }} avatarsOn=${false}
      streaming=${false} generating=${false} ...${cb} />`);
  if (off.includes('with-av') || off.includes('avatar')) throw new Error('avatarsOn=false must render no avatar markup: ' + off);
  // User messages key the map off the persona name.
  const user = renderToStaticMarkup(html`
    <${MessageItem} node=${node('av4', null, 'user', 'Hello.')}
      isRoot=${false} personaName="Ari" characterNames=${[]}
      avatars=${{ ari: { src: 'data:image/webp;base64,BBBB', full: 'data:image/webp;base64,BBBB' } }} avatarsOn=${true}
      streaming=${false} generating=${false} ...${cb} />`);
  if (!user.includes('<img')) throw new Error('persona avatar not rendered on user message: ' + user);
  // No persona image → the column stays an empty slot, never a letter tile.
  const userBare = renderToStaticMarkup(html`
    <${MessageItem} node=${node('av4b', null, 'user', 'Hello.')}
      isRoot=${false} personaName="Ari" characterNames=${[]}
      avatars=${{}} avatarsOn=${true}
      streaming=${false} generating=${false} ...${cb} />`);
  if (!userBare.includes('msg-av')) throw new Error('empty avatar slot missing on imageless user message: ' + userBare);
  if (userBare.includes('avatar-tile') || userBare.includes('<img'))
    throw new Error('imageless user message must not render a tile: ' + userBare);
  // Same for an imageless Narrator (unnarrated assistant reply).
  const narrBare = renderToStaticMarkup(html`
    <${MessageItem} node=${node('av4c', null, 'assistant', '*The rain picks up.*')}
      isRoot=${false} personaName="Ari" characterNames=${[]}
      avatars=${{}} avatarsOn=${true}
      streaming=${false} generating=${false} ...${cb} />`);
  if (!narrBare.includes('msg-av')) throw new Error('empty avatar slot missing on imageless Narrator reply: ' + narrBare);
  if (narrBare.includes('avatar-tile') || narrBare.includes('<img'))
    throw new Error('imageless Narrator reply must not render a tile: ' + narrBare);
  // …but a map entry for the Narrator does render (a piece titled "Narrator").
  const narrImg = renderToStaticMarkup(html`
    <${MessageItem} node=${node('av4d', null, 'assistant', '*The rain picks up.*')}
      isRoot=${false} personaName="Ari" characterNames=${[]}
      avatars=${{ narrator: { src: 'data:image/webp;base64,NNNN', full: 'data:image/webp;base64,NNNN' } }} avatarsOn=${true}
      streaming=${false} generating=${false} ...${cb} />`);
  if (!narrImg.includes('<img')) throw new Error('Narrator map hit should render the image: ' + narrImg);
});

// Multi-speaker: each segment row carries that speaker's avatar in the
// message gutter (image / named-character tile / bare slot for an imageless
// Narrator), exactly like a single-speaker reply — the message-level column
// stays an empty spacer and the name chips carry no avatar.
trial('avatars: multi-speaker segments carry gutter avatars', () => {
  const out = renderToStaticMarkup(html`
    <${MessageItem} node=${node('av5', null, 'assistant', 'Mia: "Hi."\n\nNarrator: *Rain starts.*\n\nSamantha: "Hey."')}
      isRoot=${false} personaName="Ari" characterNames=${['Mia', 'Samantha']}
      avatars=${{ mia: { src: 'data:image/webp;base64,CCCC', full: 'data:image/webp;base64,CCCC' } }} avatarsOn=${true}
      streaming=${false} generating=${false}
      onEdit=${() => {}} onRegenerate=${() => {}} onSwipe=${() => {}}
      onBranch=${() => {}} onRewind=${() => {}} onDelete=${() => {}} onReply=${() => {}} />`);
  const cols = out.match(/<div class="msg-av">[\s\S]*?<\/div>/g) ?? [];
  if (cols.length !== 4) throw new Error('expected the message-level spacer + 3 segment gutters: ' + out);
  if (cols[0].includes('<img') || cols[0].includes('avatar-tile'))
    throw new Error('message-level column should stay a bare spacer on multi-speaker replies: ' + cols[0]);
  if (!cols[1].includes('<img')) throw new Error("Mia's gutter should carry her image avatar: " + cols[1]);
  if (cols[2].includes('<img') || cols[2].includes('avatar-tile'))
    throw new Error('imageless Narrator gutter must render no avatar at all: ' + cols[2]);
  if (!cols[3].includes('avatar-tile') || !cols[3].includes('>S<'))
    throw new Error("Samantha's gutter should fall back to a letter tile: " + cols[3]);
  const chips = out.match(/<div class="seg-who[^"]*"[\s\S]*?<\/div>/g) ?? [];
  if (chips.length !== 3) throw new Error('expected 3 speaker chips: ' + out);
  if (!chips[1].includes('Narrator')) throw new Error('Narrator chip missing: ' + chips[1]);
  if (chips.some(c => c.includes('<img') || c.includes('avatar-tile')))
    throw new Error('name chips no longer carry avatars: ' + chips.join(' | '));
});

// Sidebar thumbnails: scenario/character/chat rows show a 24px image avatar
// when the entity has one — never a letter tile (chat rows fall back:
// scenario avatar → first linked character's → nothing).
trial('avatars: sidebar rows show image thumbnails only', () => {
  const noop = () => {};
  const characters = {
    CH1: { id: 'CH1', name: 'Mira', content: 'x', keys: [], enabled: true, avatar: 'data:image/webp;base64,DDDD' },
    CH2: { id: 'CH2', name: 'NoPic', content: 'x', keys: [], enabled: true },
  };
  const scenarios = {
    S: { id: 'S', name: 'Veyra', characterIds: ['CH1', 'CH2'], lorePieces: [], avatar: 'data:image/webp;base64,EEEE' },
    S2: { id: 'S2', name: 'Plain', characterIds: [], lorePieces: [] },
  };
  const chats = {
    C1: { id: 'C1', scenarioId: 'S', name: 'Chat one', createdAt: 1 },
    C2: { id: 'C2', scenarioId: 'S2', characterIds: ['CH1'], name: 'Chat two', createdAt: 2 },
    C3: { id: 'C3', scenarioId: 'S2', characterIds: ['CH2'], name: 'Chat three', createdAt: 3 },
  };
  const out = renderToStaticMarkup(html`
    <${fp.Sidebar} scenarios=${scenarios} chats=${chats} characters=${characters}
      selectedScenarioId=${null} selectedCharacterId=${null} selectedChatId=${null}
      onSelectScenario=${noop} onSelectCharacter=${noop} onSelectChat=${noop}
      onNewScenario=${noop} onEditScenario=${noop} onDeleteScenario=${noop} onNewChat=${noop}
      onNewCharacter=${noop} onEditCharacter=${noop} onDeleteCharacter=${noop} onNewCharacterChat=${noop}
      onExportScenario=${noop} onExportCharacter=${noop} onImport=${noop}
      onOpenPersonas=${noop} onOpenSettings=${noop} collapsed=${false} onToggleCollapse=${noop}
      onDeleteChat=${noop} sideCollapsed=${{ scenarios: false, characters: false, chats: false }}
      onToggleSection=${noop} storageKind="local" saveRetrying=${false}
      width=${300} onDragStart=${noop} onResetWidth=${noop} onChatAction=${noop} onChatContextMenu=${noop} />`);
  // 4 thumbnails: scenario Veyra, character Mira, chat one (scenario's), chat
  // two (Mira's). Plain / NoPic / Chat three have none — and no letter tiles.
  const imgs = out.match(/<img[^>]*class="avatar/g) ?? [];
  if (imgs.length !== 4) throw new Error(`expected 4 sidebar avatar thumbnails, got ${imgs.length}: ` + out);
  if (out.includes('avatar-tile')) throw new Error('sidebar must not render letter tiles: ' + out);
});

// Avatar + Lightbox components (SSR smoke): button semantics only with an
// onClick; the lightbox wraps the image in a modal with the caption under it.
trial('avatar + lightbox render (SSR smoke)', () => {
  const img = renderToStaticMarkup(html`<${fp.Avatar} name="Vex" src="data:image/webp;base64,AAAA" size=${40} onClick=${() => {}} />`);
  if (!img.includes('<img') || !img.includes('role="button"')) throw new Error('clickable image avatar broken: ' + img);
  const tile = renderToStaticMarkup(html`<${fp.Avatar} name="vex" size=${24} />`);
  if (!tile.includes('avatar-tile') || !tile.includes('>V<') || tile.includes('role="button"'))
    throw new Error('plain letter tile broken: ' + tile);
  const lb = renderToStaticMarkup(html`<${fp.Lightbox} src="data:image/webp;base64,AAAA" title="Vex" onClose=${() => {}} />`);
  if (!lb.includes('lightbox') || !lb.includes('<img') || !lb.includes('lb-cap')) throw new Error('lightbox broken: ' + lb);
});

// In-bubble swipe images (v4.10 phase 3): a pending entry shimmers, a failed
// one collapses to a dim note (prompt on the tooltip), a finished one renders
// <img class="swipe-img"> with the caption as alt — and an image-only swipe
// (/image) renders no empty markdown block.
trial('swipe images: pending / error / src / image-only render', () => {
  const cb = { onEdit: () => {}, onRegenerate: () => {}, onSwipe: () => {},
    onBranch: () => {}, onRewind: () => {}, onDelete: () => {}, onReply: () => {} };
  const imgNode = (id, images, text = 'Look at this.') => ({
    id, parentId: null, role: 'assistant', activeSwipe: 0, edited: false,
    swipes: [{ text, createdAt: 1, modelId: 'm', images }],
  });
  const render = (n) => renderToStaticMarkup(html`
    <${MessageItem} node=${n} isRoot=${false} personaName="Ari" characterNames=${[]}
      streaming=${false} generating=${false} ...${cb} />`);
  const pending = render(imgNode('im1', [{ pending: true, prompt: 'a red door', at: 1 }]));
  if (!pending.includes('img-pending')) throw new Error('pending shimmer missing: ' + pending);
  if (pending.includes('<img class="swipe-img"')) throw new Error('pending must not render an <img>: ' + pending);
  const failed = render(imgNode('im2', [{ error: true, prompt: 'a red door', at: 1 }]));
  if (!failed.includes('img-error') || !failed.includes('image unavailable'))
    throw new Error('error note missing: ' + failed);
  if (!failed.includes('title="a red door"')) throw new Error('error tooltip lost the prompt: ' + failed);
  const done = render(imgNode('im3', [{ src: 'data:image/jpeg;base64,AAAA', prompt: 'a red door', caption: 'The door', at: 1 }]));
  if (!done.includes('<img class="swipe-img"')) throw new Error('swipe image missing: ' + done);
  if (!done.includes('alt="The door"')) throw new Error('caption alt missing: ' + done);
  if (!done.includes('class="md"')) throw new Error('text + image should keep the markdown block: ' + done);
  const only = render(imgNode('im4', [{ src: 'data:image/jpeg;base64,AAAA', prompt: 'a red door', at: 1 }], ''));
  if (!only.includes('swipe-img')) throw new Error('image-only swipe lost its image: ' + only);
  if (only.includes('class="md"')) throw new Error('image-only swipe rendered an empty markdown block: ' + only);
  if (only.includes('img-swipes')) throw new Error('single take without regen must not render a take navigator: ' + only);
});

// Image takes (v4.10): takes of one placement share a `slot`; swipe.imgUsed
// picks the shown take (default last, clamped). The slot renders ONCE — the
// active take plus a ◀ n/m ▶⁺ navigator under it; ▶⁺ (only with regen
// available) re-rolls just that image.
trial('image takes: slot renders the active take once, with a take navigator', () => {
  const cb = { onEdit: () => {}, onRegenerate: () => {}, onSwipe: () => {},
    onBranch: () => {}, onRewind: () => {}, onDelete: () => {}, onReply: () => {} };
  const takeNode = (images, imgUsed) => ({
    id: 'tk1', parentId: null, role: 'assistant', activeSwipe: 0, edited: false,
    swipes: [{ text: 'Look at this.', createdAt: 1, modelId: 'm', images, ...(imgUsed ? { imgUsed } : {}) }],
  });
  const render = (n, extra = {}) => renderToStaticMarkup(html`
    <${MessageItem} node=${n} isRoot=${false} personaName="Ari" characterNames=${[]}
      streaming=${false} generating=${false} ...${cb} ...${extra} />`);
  // Everything after the img-swipes class marker — the message's own swipe
  // navigator sits BEFORE the bubble, so this slice holds only the take nav.
  const nav = (out) => out.includes('img-swipes') ? out.slice(out.indexOf('img-swipes')) : '';
  const takes = [
    { src: 'data:image/jpeg;base64,AAAA', prompt: 'a door', caption: 'take one', at: 1, slot: 's1' },
    { src: 'data:image/jpeg;base64,BBBB', prompt: 'a door', caption: 'take two', at: 2, slot: 's1' },
  ];
  // imgUsed → take 0: exactly one <img class="swipe-img">, take 0's src, counter 1/2.
  const a = render(takeNode(takes, { s1: 0 }));
  if ((a.match(/class="swipe-img"/g) ?? []).length !== 1 || !a.includes('AAAA') || a.includes('BBBB'))
    throw new Error('expected exactly the imgUsed take rendered once: ' + a);
  if (!nav(a).includes('1/2')) throw new Error('take counter missing: ' + a);
  if (nav(a).includes('⁺')) throw new Error('browsing-only nav must not offer regen: ' + a);
  // Default = last take; out-of-range imgUsed clamps into range.
  const d = render(takeNode(takes));
  if (!d.includes('BBBB') || d.includes('AAAA') || !nav(d).includes('2/2'))
    throw new Error('default active take should be the last: ' + d);
  const c = render(takeNode(takes, { s1: 99 }));
  if (!c.includes('BBBB') || !nav(c).includes('2/2')) throw new Error('imgUsed should clamp into range: ' + c);
  // ▶⁺ appears on the LAST take only when regen is available.
  const r = render(takeNode(takes), { imagesEnabled: true, onImgRegen: () => {}, onImgSwipe: () => {} });
  if (!nav(r).includes('▶\uFE0E⁺')) throw new Error('last-take nav should offer ▶⁺ regen: ' + r);
  const r0 = render(takeNode(takes, { s1: 0 }), { imagesEnabled: true, onImgRegen: () => {}, onImgSwipe: () => {} });
  if (nav(r0).includes('⁺')) throw new Error('mid-takes nav must show plain ▶, not ▶⁺: ' + r0);
  // A single take with regen available still gets the nav row (the ▶⁺ entry).
  const one = render(takeNode([{ src: 'data:image/jpeg;base64,CCCC', prompt: 'a door', at: 1, slot: 's9' }]),
    { imagesEnabled: true, onImgRegen: () => {}, onImgSwipe: () => {} });
  if (!nav(one).includes('1/1') || !nav(one).includes('▶\uFE0E⁺'))
    throw new Error('single-take regen nav missing: ' + one);
});

// Model-attached images (v4.10 phase 4): the generate_image tool call is
// recorded on the swipe (⚙ pill) alongside the pending shimmer the moment
// generation ends — the runGeneration finally stamps both in one batch.
trial('image tool call: gear pill + pending shimmer on a text-empty swipe', () => {
  const cb = { onEdit: () => {}, onRegenerate: () => {}, onSwipe: () => {},
    onBranch: () => {}, onRewind: () => {}, onDelete: () => {}, onReply: () => {} };
  const n = { id: 'im5', parentId: null, role: 'assistant', activeSwipe: 0, edited: false,
    swipes: [{ text: '', createdAt: 1, modelId: 'm', speaker: 'Narrator',
      toolCalls: [{ name: 'generate_image', ok: true, note: 'queued', args: '{"prompt":"a red door"}' }],
      images: [{ pending: true, prompt: 'a red door', caption: '', at: 1 }] }] };
  const out = renderToStaticMarkup(html`
    <${MessageItem} node=${n} isRoot=${false} personaName="Ari" characterNames=${[]}
      streaming=${false} generating=${false} ...${cb} />`);
  if (!out.includes('tools-toggle')) throw new Error('gear pill missing: ' + out);
  if (!out.includes('img-pending')) throw new Error('pending shimmer missing: ' + out);
  if (out.includes('class="md"')) throw new Error('text-empty image swipe rendered a markdown block: ' + out);
});

// A swipe whose text is all whitespace (a multi-tool reply stored before the
// generation-side trim — the newlines BETWEEN stripped blocks survived) must
// not render an empty bubble: the shell is skipped, the meta row's gear pill
// stays as the record of what happened.
trial('whitespace-only swipe: no bubble, gear pill remains', () => {
  const cb = { onEdit: () => {}, onRegenerate: () => {}, onSwipe: () => {},
    onBranch: () => {}, onRewind: () => {}, onDelete: () => {}, onReply: () => {} };
  const n = { id: 'ws1', parentId: null, role: 'assistant', activeSwipe: 0, edited: false,
    swipes: [{ text: '\n\n', createdAt: 1, modelId: 'm', speaker: 'Narrator',
      toolCalls: [{ name: 'add_lore', ok: true, note: '', args: '{}' }] }] };
  const out = renderToStaticMarkup(html`
    <${MessageItem} node=${n} isRoot=${false} personaName="Ari" characterNames=${[]}
      streaming=${false} generating=${false} ...${cb} />`);
  if (out.includes('class="bubble')) throw new Error('whitespace-only swipe rendered a bubble: ' + out);
  if (out.includes('class="md"')) throw new Error('whitespace-only swipe rendered a markdown block: ' + out);
  if (!out.includes('tools-toggle')) throw new Error('gear pill missing on a whitespace-only tool swipe: ' + out);
});

// Positional images (v4.10): a swipe image entry's `pos` (offset in the
// stripped text where its generate_image block began) drives placement —
// attached INSIDE the bubble at its head/end, embedded only genuinely
// mid-text, free-standing solely between speaker segments or on an
// image-only swipe. Swiping swaps the shown image by construction: images
// live on the swipe, and MessageItem renders node.swipes[activeSwipe].
trial('positional images: multi-segment, single end, mid-text embed, swipe switch', () => {
  const cb = { onEdit: () => {}, onRegenerate: () => {}, onSwipe: () => {},
    onBranch: () => {}, onRewind: () => {}, onDelete: () => {}, onReply: () => {} };
  const imgNode = (id, images, text, over = {}) => ({
    id, parentId: null, role: 'assistant', activeSwipe: 0, edited: false,
    swipes: [{ text, createdAt: 1, modelId: 'm', images }], ...over,
  });
  const render = (n, names = []) => renderToStaticMarkup(html`
    <${MessageItem} node=${n} isRoot=${false} personaName="Ari" characterNames=${names}
      streaming=${false} generating=${false} ...${cb} />`);

  // (a) multi-segment: pos in the gap between Narrator and Miku → the image
  // renders FREE-STANDING between the two segment bubbles, no image bubble.
  const segText = 'Narrator: *The door creaks open.*\n\nMiku: "Come in."';
  const gapPos = 'Narrator: *The door creaks open.*\n'.length; // where the block sat
  const a = render(imgNode('pa1', [{ src: 'data:image/jpeg;base64,AAAA', prompt: 'a door', at: 1, pos: gapPos }], segText), ['Miku']);
  if (!a.includes('msg-img-free')) throw new Error('multi-segment image not free-standing: ' + a);
  if ((a.match(/class="bubble/g) ?? []).length !== 2) throw new Error('expected exactly the 2 segment bubbles: ' + a);
  if (!(a.indexOf('The door creaks open.') < a.indexOf('swipe-img') && a.indexOf('swipe-img') < a.indexOf('Come in')))
    throw new Error('image not rendered between the two segment bubbles: ' + a);

  // (b) single bubble, pos at the visible end → attached INSIDE the bubble at
  // its end (a trailing image reads as part of the reply, never free-standing).
  const b = render(imgNode('pb1', [{ src: 'data:image/jpeg;base64,BBBB', prompt: 'a door', at: 1, pos: 13 }], 'Look at this.'));
  if (b.includes('msg-img-free')) throw new Error('end-pos image should ride inside the bubble: ' + b);
  if ((b.match(/class="bubble/g) ?? []).length !== 1) throw new Error('expected exactly one bubble: ' + b);
  if (!(b.indexOf('class="bubble') < b.indexOf('Look at this.') && b.indexOf('Look at this.') < b.indexOf('swipe-img')))
    throw new Error('end-pos image should follow the text inside the bubble: ' + b);
  if ((b.match(/class="md"/g) ?? []).length !== 1) throw new Error('end-pos image split the markdown: ' + b);

  // (b2) pos at the very start → attached at the head of the same bubble.
  const b2 = render(imgNode('pb2', [{ src: 'data:image/jpeg;base64,BBBB', prompt: 'a door', at: 1, pos: 0 }], 'Look at this.'));
  if (b2.includes('msg-img-free')) throw new Error('head-pos image should ride inside the bubble: ' + b2);
  if (!(b2.indexOf('class="bubble') < b2.indexOf('swipe-img') && b2.indexOf('swipe-img') < b2.indexOf('Look at this.')))
    throw new Error('head-pos image should precede the text inside the bubble: ' + b2);

  // (c) single bubble, genuinely mid-text → embedded: two markdown blocks
  // with the image between them, inside the one bubble.
  const c = render(imgNode('pc1', [{ src: 'data:image/jpeg;base64,CCCC', prompt: 'a door', at: 1, pos: 18 }], 'Before the image.\n\nAfter the image.'));
  if (c.includes('msg-img-free')) throw new Error('mid-text image must embed, not free-stand: ' + c);
  if ((c.match(/class="bubble/g) ?? []).length !== 1) throw new Error('expected one bubble: ' + c);
  if ((c.match(/class="md"/g) ?? []).length !== 2) throw new Error('embed should split the markdown in two: ' + c);
  if (!(c.indexOf('class="bubble') < c.indexOf('swipe-img'))) throw new Error('embedded image must sit inside the bubble: ' + c);
  if (!(c.indexOf('Before the image') < c.indexOf('swipe-img') && c.indexOf('swipe-img') < c.indexOf('After the image')))
    throw new Error('embedded image not between the text halves: ' + c);

  // (d) images live on the swipe: activeSwipe=1 shows that swipe's image.
  const dNode = { id: 'pd1', parentId: null, role: 'assistant', activeSwipe: 1, edited: false,
    swipes: [
      { text: 'take one', createdAt: 1, modelId: 'm', images: [{ src: 'data:image/jpeg;base64,AAAA', prompt: 'p1', at: 1 }] },
      { text: 'take two', createdAt: 2, modelId: 'm', images: [{ src: 'data:image/jpeg;base64,DDDD', prompt: 'p2', at: 2, pos: 8 }] },
    ] };
  const d = render(dNode);
  if (!d.includes('DDDD') || d.includes('AAAA')) throw new Error('activeSwipe=1 should show swipe 1 image only: ' + d);
  const d0 = render({ ...dNode, activeSwipe: 0 });
  if (!d0.includes('AAAA') || d0.includes('DDDD')) throw new Error('activeSwipe=0 should show swipe 0 image only: ' + d0);
});

// ComfyUI backend: workflow substitution + history polling are pure core.
trial('comfy: substituteComfyWorkflow — placeholders, seed rule, purity', () => {
  const graph = {
    '3': { class_type: 'KSampler', inputs: { seed: 1234, steps: 20, noise_seed: 42,
      positive: ['6', 0] } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}, cinematic' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: '{{negative}}' } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'fp_{{seed}}' } },
  };
  const out = fp.substituteComfyWorkflow(graph, { prompt: 'a fox', negative: 'blurry', width: 832, height: 1216, seed: 777 });
  // placeholders in strings substitute
  if (out['6'].inputs.text !== 'a fox, cinematic') throw new Error('prompt placeholder: ' + out['6'].inputs.text);
  if (out['7'].inputs.text !== 'blurry') throw new Error('negative placeholder: ' + out['7'].inputs.text);
  if (out['5'].inputs.width !== '832' || out['5'].inputs.height !== '1216') throw new Error('size placeholders: ' + JSON.stringify(out['5'].inputs));
  if (out['9'].inputs.filename_prefix !== 'fp_777') throw new Error('seed placeholder: ' + out['9'].inputs.filename_prefix);
  // numeric seed/noise_seed keys randomize to the SAME seed as {{seed}}
  if (out['3'].inputs.seed !== 777 || out['3'].inputs.noise_seed !== 777)
    throw new Error('numeric seed keys not randomized: ' + JSON.stringify(out['3'].inputs));
  // other numbers and non-string structures pass through untouched
  if (out['3'].inputs.steps !== 20 || out['5'].inputs.batch_size !== 1) throw new Error('non-seed numbers touched');
  if (JSON.stringify(out['3'].inputs.positive) !== '["6",0]') throw new Error('array link mangled');
  // pure: the source graph is unmutated
  if (graph['3'].inputs.seed !== 1234 || graph['6'].inputs.text !== '{{prompt}}, cinematic')
    throw new Error('source graph mutated');
  // absent seed → random per call (regen must differ)
  const r1 = fp.substituteComfyWorkflow(graph, { prompt: 'a fox' });
  const r2 = fp.substituteComfyWorkflow(graph, { prompt: 'a fox' });
  if (!Number.isInteger(r1['3'].inputs.seed) || r1['3'].inputs.seed === 1234) throw new Error('seed not randomized');
  if (r1['3'].inputs.seed === r2['3'].inputs.seed && r1['9'].inputs.filename_prefix === r2['9'].inputs.filename_prefix)
    throw new Error('two renders drew the same seed (astronomically unlikely, or rng broken)');
  if (fp.comfyRandomSeed(() => 0.999999) !== Math.floor(0.999999 * 2 ** 32)) throw new Error('comfyRandomSeed rng not honored');
});

trial('comfy: parseImageSize', () => {
  const { parseImageSize } = fp;
  const a = parseImageSize('832x1216');
  if (a.width !== 832 || a.height !== 1216) throw new Error('basic parse: ' + JSON.stringify(a));
  const b = parseImageSize(' 768 X 768 ');
  if (b.width !== 768 || b.height !== 768) throw new Error('whitespace/case parse: ' + JSON.stringify(b));
  for (const junk of ['', null, 'large', '1024', 'x1024', '1024x']) {
    const d = parseImageSize(junk);
    if (d.width !== 1024 || d.height !== 1024) throw new Error(`junk ${JSON.stringify(junk)} should fall back to 1024²: ` + JSON.stringify(d));
  }
});

trial('comfy: comfyHistoryResult — pending, error, success, keying', () => {
  const { comfyHistoryResult } = fp;
  // queued/running: empty history → not done
  if (comfyHistoryResult({}, 'p1').done) throw new Error('empty history should be pending');
  // error status surfaces the message payload
  const err = comfyHistoryResult({ p1: { status: { status_str: 'error', completed: false,
    messages: [['execution_error', { node_id: '3' }, 'KSampler blew up']] } } }, 'p1');
  if (!err.done || !err.error?.includes('KSampler blew up')) throw new Error('error status: ' + JSON.stringify(err));
  // success: first output image across node outputs wins
  const ok = comfyHistoryResult({ p1: { status: { status_str: 'success', completed: true },
    outputs: { '5': { images: [] }, '9': { images: [{ filename: 'fp_00001_.png', subfolder: '', type: 'output' }] } } } }, 'p1');
  if (!ok.done || ok.error || ok.image?.filename !== 'fp_00001_.png') throw new Error('success pick: ' + JSON.stringify(ok));
  // completed:true without status_str also counts
  if (!comfyHistoryResult({ p1: { status: { completed: true }, outputs: { '9': { images: [{ filename: 'x.png' }] } } } }, 'p1').done)
    throw new Error('completed flag not honored');
  // done but no image anywhere → explicit error
  const none = comfyHistoryResult({ p1: { status: { status_str: 'success', completed: true }, outputs: {} } }, 'p1');
  if (!none.done || !none.error) throw new Error('no-image run should error');
  // multi-record history is keyed by prompt_id
  const multi = comfyHistoryResult({
    other: { status: { status_str: 'success', completed: true }, outputs: { '9': { images: [{ filename: 'wrong.png' }] } } },
    mine: { status: { status_str: 'success', completed: true }, outputs: { '9': { images: [{ filename: 'right.png' }] } } },
  }, 'mine');
  if (multi.image?.filename !== 'right.png') throw new Error('prompt_id keying: ' + JSON.stringify(multi));
  // unknown prompt_id falls back to the first record (older servers)
  if (comfyHistoryResult({ only: { status: { status_str: 'success', completed: true },
    outputs: { '9': { images: [{ filename: 'only.png' }] } } } }, 'nope').image?.filename !== 'only.png')
    throw new Error('unkeyed fallback broken');
});

// RP prose formatting: quote pairing must survive inch marks, contractions,
// unterminated quotes, and emphasis inside speech (regression: the old
// naive /"[^"\n]+"/ regex paired a 5ft8" inch mark with the next real quote
// and mangled the HTML around it).
const proseHtml = (text) => renderToStaticMarkup(html`<${Markdown} text=${text} prose=${true} />`);

trial('prose: inch mark inside action does not eat dialogue', () => {
  const out = proseHtml('*she is 5ft8" and smirks* "Hello there."');
  if (!out.includes('<em>she is 5ft8&quot; and smirks</em>'))
    throw new Error('action em broken: ' + out);
  if (!out.includes('<span class="dialogue">&quot;Hello there.&quot;</span>'))
    throw new Error('dialogue not wrapped: ' + out);
});

trial('prose: emphasis inside speech stays nested in the dialogue span', () => {
  const out = proseHtml('"I *am* listening."');
  if (!out.includes('<span class="dialogue">&quot;I <em>am</em> listening.&quot;</span>'))
    throw new Error('em inside dialogue broken: ' + out);
});

trial('prose: unterminated quote is left raw', () => {
  const out = proseHtml('She says "hi and walks off');
  if (out.includes('class="dialogue"')) throw new Error('unterminated quote wrapped: ' + out);
});

trial('prose: two quotes on one line each get their own span', () => {
  const out = proseHtml('"hi" she said, "bye"');
  if ((out.match(/class="dialogue"/g) ?? []).length !== 2)
    throw new Error('expected 2 dialogue spans: ' + out);
});

trial('prose: curly quotes wrap; apostrophes do not interfere', () => {
  const out = proseHtml('“I don’t know,” she said.');
  if (!out.includes('<span class="dialogue">“I don’t know,”</span>'))
    throw new Error('curly dialogue broken: ' + out);
});

// Streaming auto-close: unterminated emphasis/dialogue format predictively
// while streaming; the final (non-streaming) render shows the raw text.
trial('streaming prose: unterminated emphasis + dialogue auto-close', () => {
  const em = renderToStaticMarkup(html`<${Markdown} text="*she waves" prose=${true} streaming=${true} />`);
  if (!em.includes('<em>she waves</em>')) throw new Error('em not auto-closed: ' + em);
  const bold = renderToStaticMarkup(html`<${Markdown} text="**bold words" prose=${true} streaming=${true} />`);
  if (!bold.includes('<strong>bold words</strong>')) throw new Error('bold not auto-closed: ' + bold);
  const dl = renderToStaticMarkup(html`<${Markdown} text='He says "hello the' prose=${true} streaming=${true} />`);
  if (!dl.includes('class="dialogue"')) throw new Error('dialogue not auto-closed: ' + dl);
});

trial('prose auto-close edge cases (lone star, final render raw)', () => {
  const bare = renderToStaticMarkup(html`<${Markdown} text="*" prose=${true} streaming=${true} />`);
  if (bare.includes('<em>')) throw new Error('lone star should stay literal: ' + bare);
  const final = renderToStaticMarkup(html`<${Markdown} text="*she waves" prose=${true} streaming=${false} />`);
  if (final.includes('<em>')) throw new Error('final render must show the raw unclosed star: ' + final);
  const rawQ = renderToStaticMarkup(html`<${Markdown} text='He says "hello' prose=${true} streaming=${false} />`);
  if (rawQ.includes('class="dialogue"')) throw new Error('final render must leave unterminated quote raw: ' + rawQ);
});

// Stored-XSS sanitizing (marked.use config in 00-imports.js): raw HTML from
// model output / imported cards is escaped, script-capable hrefs neutralized,
// while the app's own dialogue spans and normal markdown still render.
const mdHtml = (text) => renderToStaticMarkup(html`<${Markdown} text=${text} />`);

trial('xss: <img onerror> payload renders inert (escaped to text)', () => {
  const out = mdHtml('<img src=x onerror=alert(1)>');
  if (out.includes('<img')) throw new Error('raw img tag survived: ' + out);
  if (!out.includes('&lt;img src=x onerror=alert(1)&gt;'))
    throw new Error('payload not escaped to text: ' + out);
});

trial('xss: <script> block is escaped', () => {
  const out = mdHtml('<script>alert(1)</script>');
  if (out.includes('<script>')) throw new Error('script tag survived: ' + out);
  if (!out.includes('&lt;script&gt;')) throw new Error('script not escaped: ' + out);
});

trial('xss: javascript:/data: links neutralized, text kept', () => {
  for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,xss']) {
    const out = mdHtml(`[click me](${href})`);
    if (out.includes('<a ')) throw new Error(`link with href ${JSON.stringify(href)} survived: ` + out);
    if (!out.includes('click me')) throw new Error('link text lost: ' + out);
  }
});

trial('xss: safe links and images still render', () => {
  const out = mdHtml('[site](https://example.com) ![alt](https://example.com/x.png) [mail](mailto:a@b.c) [rel](#anchor)');
  if (!out.includes('href="https://example.com"')) throw new Error('https link dropped: ' + out);
  if (!out.includes('<img src="https://example.com/x.png" alt="alt">')) throw new Error('safe image broken: ' + out);
  if (!out.includes('href="mailto:a@b.c"')) throw new Error('mailto link dropped: ' + out);
  if (!out.includes('href="#anchor"')) throw new Error('anchor link dropped: ' + out);
});

trial('xss: data:/javascript: image src neutralized', () => {
  const out = mdHtml('![x](data:text/html;base64,PHNjcmlwdD4=)');
  if (out.includes('<img')) throw new Error('data: image survived: ' + out);
});

trial('xss: dialogue spans still render in prose mode, hostile html inert', () => {
  const out = proseHtml('"Hello there." *she waves* <img src=x onerror=alert(1)>');
  if (!out.includes('<span class="dialogue">&quot;Hello there.&quot;</span>'))
    throw new Error('dialogue span broken by sanitizer: ' + out);
  if (!out.includes('<em>she waves</em>')) throw new Error('action em broken: ' + out);
  if (out.includes('<img')) throw new Error('img payload survived in prose mode: ' + out);
});

trial('xss: normal markdown (emphasis, code, quote, table) still works', () => {
  const out = mdHtml('*em* `code` **bold**\n\n> quoted\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  for (const frag of ['<em>em</em>', '<code>code</code>', '<strong>bold</strong>', '<blockquote>', '<table>', '<td>1</td>'])
    if (!out.includes(frag)) throw new Error(`missing ${frag}: ` + out);
});

// ProbsView renders per-token spans with popovers (no client JS needed for SSR).
trial('ProbsView renders tokens + alternatives', () => {
  const out = renderToStaticMarkup(html`
    <${fp.ProbsView} tokens=${[
      { text: 'Hello', logprob: -0.1, top: [{ token: 'Hi', logprob: -0.5 }, { token: 'Hey', logprob: -1.2 }] },
      { text: ' world', logprob: -2.0, top: [{ token: ' there', logprob: -0.3 }] },
      { text: '\n', logprob: null, top: [] },
    ]} onPick=${() => {}} />`);
  if (!out.includes('probs-view') || !out.includes('world')) throw new Error('probs view markup incomplete');
  if (!out.includes('90.5%')) throw new Error('probability % missing');
});

// The streaming normalizer parses vLLM logprobs chunks and sends logit_bias.
// Real vLLM shape: logprobs at CHOICE level (choices[0].logprobs.content),
// first chunk has logprobs:null; delta-nested is tolerated as a fallback.
// The parser yields independent streams: {content} text chunks and {lp}
// tape records — stop/EOS filtering applies to both.
trial('openaiChatStream: content/lp split + request body', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"role":"assistant","content":""},"logprobs":null}]}',
    'data: {"choices":[{"delta":{"content":"Hel"},"logprobs":{"content":[{"token":"Hel","logprob":-0.2,"top_logprobs":[{"token":"Hel","logprob":-0.2},{"token":"Hi","logprob":-1.1}]}]}}]}',
    // inline stop-string match in the logprobs path — must be filtered
    'data: {"choices":[{"delta":{},"logprobs":{"content":[{"token":"<turn|>","logprob":-0.4,"top_logprobs":[]}]}}]}',
    'data: {"choices":[{"delta":{"content":"lo","logprobs":{"content":[{"token":"lo","logprob":-3.0,"top_logprobs":[]}]}}}]}',
    'data: {"choices":[{"delta":{"content":"!","logprobs":{"content":[{"token":"!","logprob":-0.9,"top_logprobs":[]}]}}}]}',
    // inline stop-string match in the plain path — must be filtered
    'data: {"choices":[{"delta":{"content":"<turn|>"}}]}',
    // real vLLM stop emission: finish_reason set, empty delta, EOS in logprobs
    'data: {"choices":[{"finish_reason":"stop","delta":{},"logprobs":{"content":[{"token":"<turn|>","logprob":-0.01,"top_logprobs":[]}]}}]}',
    'data: [DONE]', '',
  ].join('\n');
  let sentBody = null;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const chunks = [];
    for await (const c of fp.openaiChatStream({ endpoint: 'http://x/v1', model: 'm', messages: [], tokenProbs: true, logitBias: { '123': -5 }, stop: ['<turn|>'] }))
      chunks.push(c);
    const text = chunks.filter(c => c.content != null).map(c => c.content).join('');
    if (text !== 'Hello!') throw new Error('stop token leaked into text: ' + JSON.stringify(text));
    const tape = chunks.filter(c => c.lp).flatMap(c => c.lp);
    if (tape.length !== 3) throw new Error('tape length ' + tape.length + ': ' + JSON.stringify(tape));
    if (tape[0].token !== 'Hel' || tape[0].logprob !== -0.2 || tape[0].top.length !== 2)
      throw new Error('bad tape entry: ' + JSON.stringify(tape[0]));
    if (tape[1].token !== 'lo' || tape[1].logprob !== -3.0) throw new Error('delta-nested fallback broken: ' + JSON.stringify(tape[1]));
    if (tape[2].token !== '!' || tape[2].logprob !== -0.9) throw new Error('choice-level logprobs broken: ' + JSON.stringify(tape[2]));
    if (tape.some(t => t.token === '<turn|>')) throw new Error('EOS/stop token leaked into tape');
    if (sentBody.logprobs !== true || sentBody.top_logprobs !== 10) throw new Error('logprobs not requested');
    if (sentBody.logit_bias?.['123'] !== -5) throw new Error('logit_bias not sent');
    if (!Array.isArray(sentBody.stop) || sentBody.stop[0] !== '<turn|>') throw new Error('stop not sent');
  } finally { globalThis.fetch = oldFetch; }
});

// Reasoning channel: delta.reasoning_content (vLLM/DeepSeek) and
// delta.reasoning (OpenRouter) yield { think } records, kept out of content.
trial('openaiChatStream: reasoning_content captured as { think }', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"reasoning_content":"Let me "}}]}',
    'data: {"choices":[{"delta":{"reasoning":"think"}}]}',
    'data: {"choices":[{"delta":{"content":"Answer."}}]}',
    'data: {"choices":[{"finish_reason":"stop","delta":{}}]}',
    'data: [DONE]', '',
  ].join('\n');
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  try {
    const chunks = [];
    for await (const c of fp.openaiChatStream({ endpoint: 'http://x/v1', model: 'm', messages: [] })) chunks.push(c);
    const think = chunks.filter(c => c.think != null).map(c => c.think).join('');
    if (think !== 'Let me think') throw new Error('reasoning lost or reordered: ' + JSON.stringify(think));
    const text = chunks.filter(c => c.content != null).map(c => c.content).join('');
    if (text !== 'Answer.') throw new Error('reasoning leaked into content: ' + JSON.stringify(text));
    if (!chunks.some(c => c.done)) throw new Error('done chunk missing');
  } finally { globalThis.fetch = oldFetch; }
});

// Content and lp streams are independent: deltas may be arbitrary byte
// windows with logprob entries attached off by one (observed through a
// re-chunking middleware). Text must pass through untouched; the tape is
// aligned ONCE, globally, by alignTokensToSpans.
trial('openaiChatStream + alignTokensToSpans: off-by-one middleware shape', async () => {
  const sse = [
    // deltas are byte windows; each chunk's lp token belongs to the NEXT
    // window (globally: tape = text minus the leading "*W")
    'data: {"choices":[{"delta":{"content":"*Wipin"},"logprobs":{"content":[{"token":"iping","logprob":-0.5,"top_logprobs":[{"token":"iping","logprob":-0.5}]}]}}]}',
    'data: {"choices":[{"delta":{"content":"g down"},"logprobs":{"content":[{"token":" down","logprob":-0.3,"top_logprobs":[]}]}}]}',
    'data: [DONE]', '',
  ].join('\n');
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  try {
    let text = '';
    const tape = [];
    for await (const c of fp.openaiChatStream({ endpoint: 'http://x/v1', model: 'm', messages: [], tokenProbs: true })) {
      if (c.lp) { tape.push(...c.lp); continue; }
      text += c.content;
    }
    if (text !== '*Wiping down') throw new Error('text lost or reordered: ' + JSON.stringify(text));
    const spans = fp.alignTokensToSpans(text, tape);
    if (spans.map(s => s.text).join('') !== text) throw new Error('spans do not cover text: ' + JSON.stringify(spans));
    if (spans.length !== 3) throw new Error('span count ' + spans.length + ': ' + JSON.stringify(spans));
    if (spans[0].text !== '*W' || spans[0].logprob !== null)
      throw new Error('leading offset span should be plain: ' + JSON.stringify(spans[0]));
    if (spans[1].text !== 'iping' || spans[1].logprob !== -0.5 || spans[1].top.length !== 1)
      throw new Error('token lost its probs: ' + JSON.stringify(spans[1]));
    if (spans[2].text !== ' down' || spans[2].logprob !== -0.3)
      throw new Error('token lost its probs: ' + JSON.stringify(spans[2]));
  } finally { globalThis.fetch = oldFetch; }
});

// Chunks with no choices (trailing usage-only chunk, middleware keep-alives)
// must be skipped, not crash on choice.finish_reason.
trial('openaiChatStream: choices-less chunks are skipped', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"Hi"}}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":1}}',
    'data: {"id":"x","object":"chat.completion.chunk"}',
    'data: {"choices":[{"delta":{"content":"!"},"finish_reason":null}]}',
    'data: {"choices":[{"finish_reason":"stop","delta":{}}]}',
    'data: [DONE]', '',
  ].join('\n');
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  try {
    const chunks = [];
    for await (const c of fp.openaiChatStream({ endpoint: 'http://x/v1', model: 'm', messages: [] }))
      chunks.push(c);
    const text = chunks.map(c => c.content).join('');
    if (text !== 'Hi!') throw new Error('bad text around choices-less chunks: ' + JSON.stringify(text));
  } finally { globalThis.fetch = oldFetch; }
});

// alignTokensToSpans: exact tiling, suffix/prefix anchoring (off-by-one and
// partial tapes), greedy fallback with gaps, and degenerate inputs.
trial('alignTokensToSpans: exact / suffix / prefix / greedy / degenerate', () => {
  const A = fp.alignTokensToSpans;
  const cover = (spans, text) => spans.map(s => s.text).join('') === text;

  // exact: healthy per-token stream
  let spans = A('Hello!', [
    { token: 'Hel', logprob: -0.2, top: [{ token: 'Hel', logprob: -0.2 }] },
    { token: 'lo', logprob: -3.0, top: [] },
    { token: '!', logprob: -0.9, top: [] },
  ]);
  if (spans.length !== 3 || !cover(spans, 'Hello!') || spans.some(s => s.logprob == null))
    throw new Error('exact: ' + JSON.stringify(spans));

  // suffix: tape = text minus a leading span (the off-by-one middleware case);
  // the trailing "a" must win over the identical leading text
  spans = A('a banana is a', [{ token: 'a', logprob: -0.7, top: [] }]);
  if (spans.length !== 2 || !cover(spans, 'a banana is a')
    || spans[0].text !== 'a banana is ' || spans[0].logprob !== null
    || spans[1].text !== 'a' || spans[1].logprob !== -0.7)
    throw new Error('suffix: ' + JSON.stringify(spans));

  // prefix: tape covers the head only
  spans = A('Hi there friend', [
    { token: 'Hi', logprob: -0.2, top: [] },
    { token: ' there', logprob: -0.4, top: [] },
  ]);
  if (spans.length !== 3 || !cover(spans, 'Hi there friend')
    || spans[2].text !== ' friend' || spans[2].logprob !== null)
    throw new Error('prefix: ' + JSON.stringify(spans));

  // greedy: tape tiles with a gap; unmatchable tape is dropped, text kept
  spans = A('Hi thereok', [
    { token: 'Hi', logprob: -0.1, top: [] },
    { token: 'there', logprob: -0.6, top: [] },
    { token: 'zzz', logprob: -9, top: [] },
  ]);
  if (!cover(spans, 'Hi thereok')
    || spans[0].text !== 'Hi' || spans[0].logprob !== -0.1
    || spans[1].text !== ' ' || spans[1].logprob !== null
    || spans[2].text !== 'there' || spans[2].logprob !== -0.6
    || spans[3].text !== 'ok' || spans[3].logprob !== null)
    throw new Error('greedy: ' + JSON.stringify(spans));

  // degenerate: no tape → one plain span; no text → nothing
  spans = A('plain message', []);
  if (spans.length !== 1 || spans[0].text !== 'plain message' || spans[0].logprob !== null)
    throw new Error('no-tape: ' + JSON.stringify(spans));
  if (A('', [{ token: 'x', logprob: -1, top: [] }]).length !== 0) throw new Error('empty text should yield no spans');

  // distant-token trap: with lp entries missing at the start AND mid-stream,
  // the tape's later " I" token must not be yanked forward to match the "I"
  // at position 1 — the skip cost keeps alignment (plain "*I" and " the" gaps)
  spans = A('*I lean back against the wall I said', [
    { token: ' lean', logprob: -0.1, top: [] },
    { token: ' back', logprob: -0.2, top: [] },
    { token: ' against', logprob: -0.3, top: [] },
    { token: ' wall', logprob: -0.5, top: [] },
    { token: ' I', logprob: -0.6, top: [] },
    { token: ' said', logprob: -0.7, top: [] },
  ]);
  if (!cover(spans, '*I lean back against the wall I said'))
    throw new Error('distant-token: coverage ' + JSON.stringify(spans));
  if (spans[0].text !== '*I' || spans[0].logprob !== null || spans[4].text !== ' the' || spans[4].logprob !== null)
    throw new Error('distant-token: gaps wrong: ' + JSON.stringify(spans));
  const annotated = spans.filter(s => s.logprob != null);
  if (annotated.length !== 6 || annotated.some((s, i) => s.text !== [' lean',' back',' against',' wall',' I',' said'][i]))
    throw new Error('distant-token: tokens misattributed: ' + JSON.stringify(spans));

  // reasoning-model tape: leading think tokens the content never shows
  // (suffix-of-tape fast case — reasoning always streams before content)
  spans = A('Mia: hello there', [
    { token: 'Okay', logprob: -2.0, top: [] },
    { token: ' let', logprob: -2.0, top: [] },
    { token: ' me think.', logprob: -2.0, top: [] },
    { token: 'Mia', logprob: -0.1, top: [] },
    { token: ': hello', logprob: -0.2, top: [] },
    { token: ' there', logprob: -0.3, top: [] },
  ]);
  if (!cover(spans, 'Mia: hello there')
    || spans.length !== 3 || spans.some(s => s.logprob == null || s.logprob === -2.0))
    throw new Error('think-prefix: ' + JSON.stringify(spans));

  // interleaved think junk beyond the greedy resync window: junk is dropped,
  // every prose token keeps its prob
  const thinkJunk = Array.from({ length: 6 }, (_, k) => ({ token: `~t${k}~`, logprob: -5, top: [] }));
  spans = A('Character: nods slowly', [
    { token: 'Hmm', logprob: -5, top: [] },
    { token: 'Character', logprob: -0.1, top: [] },
    { token: ':', logprob: -0.2, top: [] },
    { token: ' nods', logprob: -0.3, top: [] },
    ...thinkJunk,
    { token: ' slowly', logprob: -0.4, top: [] },
  ]);
  if (!cover(spans, 'Character: nods slowly'))
    throw new Error('think-interleaved: coverage ' + JSON.stringify(spans));
  const kept = spans.filter(s => s.logprob != null);
  if (kept.length !== 4 || kept.map(s => s.text).join('') !== 'Character: nods slowly')
    throw new Error('think-interleaved: probs lost ' + JSON.stringify(spans));
});

// alignStrippedToolSpans: tape covers the RAW reply (tool blocks included);
// spans must project onto the stripped text, protocol tokens vanish, prose
// keeps its probs.
trial('alignStrippedToolSpans: probs survive tool-block stripping', () => {
  const raw = 'Hi ```tool\n{"tool":"add_lore","args":{"title":"X","content":"Y"}}\n``` there';
  const { text: stripped, map } = fp.stripToolBlocksMapped(raw);
  if (stripped !== 'Hi  there') throw new Error('strip: ' + JSON.stringify(stripped));
  const tape = [
    { token: 'Hi ', logprob: -0.1, top: [{ token: 'Hi', logprob: -0.1 }] },
    { token: '```tool\n{"tool":"add_lore","args":{"title":"X","content":"Y"}}\n```', logprob: -1.0, top: [] },
    { token: ' there', logprob: -0.4, top: [{ token: ' there', logprob: -0.4 }] },
  ];
  const spans = fp.alignStrippedToolSpans(raw, tape, map, 0, stripped);
  if (!spans) throw new Error('projection returned null');
  if (spans.map(s => s.text).join('') !== stripped) throw new Error('coverage: ' + JSON.stringify(spans));
  const annotated = spans.filter(s => s.logprob != null);
  if (annotated.length !== 2 || annotated[0].text !== 'Hi ' || annotated[1].text !== ' there')
    throw new Error('prose probs lost: ' + JSON.stringify(spans));

  // token straddling the strip boundary: prob survives on the kept fragment
  const raw2 = 'a ```tool\n{}\n```b';
  const m2 = fp.stripToolBlocksMapped(raw2);
  if (m2.text !== 'a b') throw new Error('strip2: ' + JSON.stringify(m2.text));
  const spans2 = fp.alignStrippedToolSpans(raw2, [
    { token: 'a ```tool\n{}\n```b', logprob: -0.3, top: [] },
  ], m2.map, 0, m2.text);
  if (!spans2 || spans2.map(s => s.text).join('') !== 'a b'
    || spans2[0].text !== 'a ' || spans2[0].logprob !== -0.3
    || spans2[1].text !== 'b' || spans2[1].logprob !== -0.3)
    throw new Error('straddle: ' + JSON.stringify(spans2));

  // map/stripped mismatch → null (caller falls back)
  if (fp.alignStrippedToolSpans(raw, tape, map, 0, 'something else') !== null)
    throw new Error('mismatch should return null');
});

// Continuation case: the map is slice-relative, so attachProbs rebases it to
// absolute raw indices (rawOffset > 0). An unrebased map must NOT be passed.
trial('alignStrippedToolSpans: continuation rawOffset > 0', () => {
  const base = 'Once upon a time. ';
  const slice = 'Hi ```tool\n{"tool":"add_lore","args":{"title":"X","content":"Y"}}\n``` there';
  const { text: stripped, map } = fp.stripToolBlocksMapped(slice);
  const tape = [
    { token: 'Hi ', logprob: -0.1, top: [] },
    { token: '```tool\n{"tool":"add_lore","args":{"title":"X","content":"Y"}}\n```', logprob: -1.0, top: [] },
    { token: ' there', logprob: -0.4, top: [] },
  ];
  const off = base.length;
  const spans = fp.alignStrippedToolSpans(slice, tape, map.map(j => j + off), off, stripped);
  if (!spans) throw new Error('continuation projection returned null');
  if (spans.map(s => s.text).join('') !== stripped) throw new Error('continuation coverage: ' + JSON.stringify(spans));
  const annotated = spans.filter(s => s.logprob != null);
  if (annotated.length !== 2 || annotated[0].text !== 'Hi ' || annotated[1].text !== ' there')
    throw new Error('continuation probs lost: ' + JSON.stringify(spans));
});
// /tokenize shape tolerance: {tokens:[ids]}, count-only, and 404 → null.
trial('tokenize: ids / count-only / unavailable', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ count: 7, tokens: [1, 2, 3, 4, 5, 6, 7] }), { status: 200 });
    const r = await fp.tokenize({ endpoint: 'http://a', model: 'm', prompt: 'one' });
    if (r?.count !== 7 || r.ids?.length !== 7) throw new Error('ids shape: ' + JSON.stringify(r));
    globalThis.fetch = async () => new Response(JSON.stringify({ count: 3 }), { status: 200 });
    const r2 = await fp.tokenize({ endpoint: 'http://b', model: 'm', prompt: 'two' });
    if (r2?.count !== 3 || r2.ids !== null) throw new Error('count-only shape: ' + JSON.stringify(r2));
    globalThis.fetch = async () => new Response('nope', { status: 404 });
    const r3 = await fp.tokenize({ endpoint: 'http://c', model: 'm', prompt: 'three' });
    if (r3 !== null) throw new Error('404 should degrade to null');
    if (await fp.getTokenCount({ endpoint: 'http://a', model: 'm', text: 'one' }) !== 7)
      throw new Error('getTokenCount should hit the cache');
  } finally { globalThis.fetch = oldFetch; }
});

// embed: batch parse (index-sorted), cache, and error propagation.
trial('embed: response parsing, cache, errors', async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, opts) => {
      calls++;
      const body = JSON.parse(opts.body);
      if (body.model === 'bad') return new Response(JSON.stringify({ error: { message: 'no such model' } }), { status: 400 });
      return new Response(JSON.stringify({ data: body.input.map((_, i) => ({ index: i, embedding: [i, 0, 1] })).reverse() }), { status: 200 });
    };
    const vecs = await fp.embed({ endpoint: 'http://e', model: 'emb', inputs: ['a', 'b'] });
    if (vecs.length !== 2 || vecs[0][0] !== 0 || vecs[1][0] !== 1) throw new Error('index sort/parse: ' + JSON.stringify(vecs));
    const before = calls;
    await fp.embedCached({ endpoint: 'http://e', model: 'emb', text: 'piece text' });
    await fp.embedCached({ endpoint: 'http://e', model: 'emb', text: 'piece text' });
    if (calls !== before + 1) throw new Error('embedCached did not cache');
    let threw = false;
    try { await fp.embed({ endpoint: 'http://e', model: 'bad', inputs: ['x'] }); }
    catch (e) { threw = /no such model/.test(e.message); }
    if (!threw) throw new Error('HTTP/API error not propagated');
    // cosine sanity: identical → 1, orthogonal → 0
    if (Math.abs(fp.cosine([1, 2, 3], [1, 2, 3]) - 1) > 1e-9) throw new Error('cosine identity');
    if (fp.cosine([1, 0], [0, 1]) !== 0) throw new Error('cosine orthogonal');
    if (!(fp.SEMANTIC_THRESHOLD > 0 && fp.SEMANTIC_THRESHOLD < 1)) throw new Error('threshold sane');
  } finally { globalThis.fetch = oldFetch; }
});

// authHeaders: direct endpoint → Authorization; same-origin /proxy/ → X-Real-Authorization.
trial('authHeaders: proxy vs direct credential mapping', async () => {
  const seen = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    seen.push({ url, headers: opts.headers });
    return new Response('data: {"choices":[{"delta":{"content":"x"}}]}\ndata: [DONE]\n', { status: 200 });
  };
  try {
    for await (const _ of fp.openaiChatStream({ endpoint: 'http://llm.local/v1', apiKey: 'k1', model: 'm', messages: [] })) {}
    for await (const _ of fp.openaiChatStream({ endpoint: '/proxy/http://llm.local', apiKey: 'k1', model: 'm', messages: [] })) {}
    const [direct, proxied] = seen;
    if (direct.headers.Authorization !== 'Bearer k1') throw new Error('direct endpoint should send Authorization');
    if ('X-Real-Authorization' in direct.headers) throw new Error('direct endpoint should not send X-Real-Authorization');
    if (proxied.headers['X-Real-Authorization'] !== 'Bearer k1') throw new Error('proxy endpoint should send X-Real-Authorization');
    if ('Authorization' in proxied.headers) throw new Error('proxy endpoint must not clobber Authorization (Basic lives there)');
  } finally { globalThis.fetch = oldFetch; }
});

// effectiveEndpoint: /proxy/ rewrite only when toggle on + server storage active.
trial('effectiveEndpoint rewriting', () => {
  const s = (over) => ({ endpoint: 'http://llm.local:8080', ...over });
  if (fp.effectiveEndpoint(s({}), true) !== '/proxy/http://llm.local:8080') throw new Error('toggle on + server should rewrite');
  if (fp.effectiveEndpoint(s({ routeViaServer: false }), true) !== 'http://llm.local:8080') throw new Error('toggle off → raw');
  if (fp.effectiveEndpoint(s({}), false) !== 'http://llm.local:8080') throw new Error('server inactive → raw despite toggle');
  if (fp.effectiveEndpoint(s({ endpoint: '/proxy/http://x' }), true) !== '/proxy/http://x') throw new Error('already /proxy/ unchanged (no double-proxy)');
  if (fp.effectiveEndpoint(s({ endpoint: '' }), true) !== '') throw new Error('empty unchanged');
});

// roleConn: per-role endpoint/key overrides, per-field inheritance, chains.
trial('roleConn: per-field inheritance + role chains', () => {
  const base = { endpoint: 'http://main:8080', apiKey: 'MAIN' };
  // no overrides → main, with or without roles
  for (const roles of [[], ['aux'], ['gen', 'aux'], ['image']]) {
    const c = fp.roleConn(base, ...roles);
    if (c.endpoint !== 'http://main:8080' || c.apiKey !== 'MAIN') throw new Error(`blank should inherit main: ${JSON.stringify(c)}`);
  }
  // endpoint-only override inherits the key (the old image-connection rule)
  const img = fp.roleConn({ ...base, imageEndpoint: 'http://img:8188' }, 'image');
  if (img.endpoint !== 'http://img:8188' || img.apiKey !== 'MAIN') throw new Error('endpoint-only override: ' + JSON.stringify(img));
  // key-only override keeps the main endpoint
  const keyOnly = fp.roleConn({ ...base, auxApiKey: 'AUXKEY' }, 'aux');
  if (keyOnly.endpoint !== 'http://main:8080' || keyOnly.apiKey !== 'AUXKEY') throw new Error('key-only override: ' + JSON.stringify(keyOnly));
  // generator chain: gen set wins; blank gen falls through to aux; blank both → main
  const genWins = fp.roleConn({ ...base, genEndpoint: 'http://gen:1', auxEndpoint: 'http://aux:2', genApiKey: 'G', auxApiKey: 'A' }, 'gen', 'aux');
  if (genWins.endpoint !== 'http://gen:1' || genWins.apiKey !== 'G') throw new Error('gen should win: ' + JSON.stringify(genWins));
  const genFalls = fp.roleConn({ ...base, auxEndpoint: 'http://aux:2', auxApiKey: 'A' }, 'gen', 'aux');
  if (genFalls.endpoint !== 'http://aux:2' || genFalls.apiKey !== 'A') throw new Error('gen should fall to aux: ' + JSON.stringify(genFalls));
  const auxDirect = fp.roleConn({ ...base, genEndpoint: 'http://gen:1' }, 'aux');
  if (auxDirect.endpoint !== 'http://main:8080') throw new Error('aux must not see gen overrides: ' + JSON.stringify(auxDirect));
  // whitespace-only counts as blank
  const ws = fp.roleConn({ ...base, auxEndpoint: '   ' }, 'aux');
  if (ws.endpoint !== 'http://main:8080') throw new Error('whitespace override should inherit');
});

// ---- BranchPanel (outline): the condensed view tracks the live tree ----
// The panel derives everything from its chat prop on every render (no memo)
// and the modal passes the live chats[chatId], so a branch created in the
// chat shows on the next state flush. These pin the condensation itself:
// forks appear when a node gains sibling continuations, chips/counts grow,
// the active highlight follows activateBranch jumps, swipe tags mark
// children continuing different parent swipes.
const bvRender = (chat) => renderToStaticMarkup(html`<${fp.BranchPanel} chat=${chat} personaName="Ari" onJump=${() => {}} />`);
const bvChain = (steps) => {
  let chat = { id: 'C', scenarioId: 'S', rootMessageId: null, activeLeafId: null, messages: {} };
  let parent = null; const ids = [];
  for (const [role, text] of steps) {
    const r = fp.appendMessage(chat, parent, role, text);
    chat = r.chat; parent = r.id; ids.push(r.id);
  }
  return { chat, ids };
};

trial('branch view outline: linear chat collapses to one segment, no forks', () => {
  const { chat } = bvChain([['assistant', 'Welcome, Ari.'], ['user', 'I head to the dock.'], ['assistant', 'Vex grins.']]);
  const out = bvRender(chat);
  if (!out.includes('3 messages · 0 branch points.') || !out.includes('No branches yet'))
    throw new Error('linear chat should report no branch points');
  if (out.includes('ct-br')) throw new Error('linear chat should render no fork chips');
  if (!out.includes('3 msg')) throw new Error('the whole chain should collapse into one segment');
});

trial('branch view outline: sibling continuation forks, and the view grows', () => {
  const { chat: c0, ids } = bvChain([['assistant', 'Welcome, Ari.'], ['user', 'dock.'], ['assistant', 'Vex grins.'], ['user', 'credits.'], ['assistant', 'Vex pockets them.']]);
  // regenerate-style fork: a second assistant continuation under u2 (#4)
  let r = fp.appendMessage(c0, ids[3], 'assistant', 'Vex counts them twice.');
  let chat = r.chat;
  let out = bvRender(chat);
  if (!out.includes('6 messages · 1 branch point.')) throw new Error('fork not counted');
  if (!out.includes('⎇ 2')) throw new Error('fork chip missing');
  for (const t of ['Vex pockets them.', 'Vex counts them twice.'])
    if (!out.includes(t)) throw new Error(`fork branch "${t}" not shown`);
  if ((out.match(/>#5</g) ?? []).length !== 2) throw new Error('both fork segments should start at #5');
  // growth: a third continuation under the same parent bumps the chip only
  r = fp.appendMessage(chat, ids[3], 'assistant', 'Vex shakes his head.'); chat = r.chat;
  out = bvRender(chat);
  if (!out.includes('⎇ 3') || !out.includes('1 branch point.')) throw new Error('third continuation should bump the chip, not the count');
  // growth: a fork deeper down adds a second branch point
  r = fp.appendMessage(chat, ids[4], 'user', 'Keep the change.'); chat = r.chat;
  r = fp.appendMessage(chat, ids[4], 'user', 'Walk away.'); chat = r.chat;
  out = bvRender(chat);
  if (!out.includes('2 branch points.')) throw new Error('deeper fork should grow the branch-point count');
  for (const t of ['Keep the change.', 'Walk away.'])
    if (!out.includes(t)) throw new Error(`deeper branch "${t}" not shown`);
});

trial('branch view outline: active highlight follows branch jumps', () => {
  const { chat: c0, ids } = bvChain([['assistant', 'Welcome, Ari.'], ['user', 'dock.'], ['assistant', 'Vex grins.'], ['user', 'credits.'], ['assistant', 'Vex pockets them.']]);
  const r = fp.appendMessage(c0, ids[3], 'assistant', 'Vex counts them twice.');
  // the new continuation is the tip; jump back to the first one
  const chat = fp.activateBranch(r.chat, ids[4]);
  if (fp.getActivePath(chat.messages, chat.activeLeafId).at(-1).id !== ids[4])
    throw new Error('jump did not land on the first continuation');
  const row = bvRender(chat).split('<button').find(b => b.includes('ct-row active leaf'));
  if (!row?.includes('Vex pockets them.')) throw new Error('active leaf row is not the jumped-to branch');
});

trial('branch view outline: swipe tags mark different parent swipes', () => {
  const { chat: c0, ids } = bvChain([['assistant', 'Welcome.'], ['user', 'hi'], ['assistant', 'take one']]);
  let r = fp.appendMessage(c0, ids[2], 'user', 'continued from take one'); // fromSwipe 0
  // the parent gains a second swipe; continuing from it forks with fromSwipe 1
  const a1 = r.chat.messages[ids[2]];
  const chat1 = { ...r.chat, messages: { ...r.chat.messages,
    [ids[2]]: { ...a1, swipes: [...a1.swipes, { text: 'take two', createdAt: Date.now() }], activeSwipe: 1 } } };
  r = fp.appendMessage(chat1, ids[2], 'user', 'continued from take two');
  const out = bvRender(r.chat);
  if (!out.includes('swipe 1') || !out.includes('swipe 2'))
    throw new Error('sibling rows should tag their differing parent swipes');
});

trial('branch view outline: empty chat renders the empty state', () => {
  if (!bvRender({ id: 'C', messages: {}, activeLeafId: null }).includes('No messages yet.'))
    throw new Error('empty state missing');
});

// delta.content is the text authority: misaligned logprobs must not lose text.
for (const [name, fn] of trials) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`THROW ${name}: ${e.message}`); }
}
console.log(failures ? `\n${failures} trial(s) THREW` : '\nNo throws reproduced');
process.exit(failures ? 1 : 0);
