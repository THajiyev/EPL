(() => {
  const { listSeasons, loadSeason, hasNewResults, winsOf } = CircleMatches;
  const { loadCrests } = CircleCrests;
  const { createRing } = CircleRing;
  const { renderCircleImage } = CircleSnapshot;
  const { formatCount, formatDate, formatLongDate, matchSummary, teamName, winnerScore } = CircleFormat;

  const elements = {
    seasonSelect: document.getElementById("season-select"),
    themeToggle: document.getElementById("theme-toggle"),
    summary: document.getElementById("summary"),
    notice: document.getElementById("notice"),
    figure: document.getElementById("figure"),
    ring: document.getElementById("ring"),
    loading: document.getElementById("loading"),
    loadingText: document.getElementById("loading-text"),
    progressBar: document.getElementById("progress-bar"),
    empty: document.getElementById("empty"),
    tooltip: document.getElementById("tooltip"),
    prev: document.getElementById("prev"),
    next: document.getElementById("next"),
    random: document.getElementById("random"),
    saveImage: document.getElementById("save-image"),
    copyImage: document.getElementById("copy-image"),
    counter: document.getElementById("counter"),
    chain: document.getElementById("chain"),
    matchList: document.getElementById("match-list"),
    matchCount: document.getElementById("match-count"),
    matchGroups: document.getElementById("match-groups"),
  };

  const seasonData = new Map();
  const seasonResults = new Map();
  const crestUrls = new Map();
  const lastFreshnessCheck = new Map();
  const FRESHNESS_CHECK_MS = 60 * 1000;

  const state = {
    season: null,
    data: null,
    graph: null,
    circles: [],
    search: null,
    generative: false,
    generating: false,
    seen: new Set(),
    longest: 0,
    visible: [],
    position: 0,
    pinnedEdge: null,
    loadToken: 0,
  };

  const ring = createRing(elements.ring, {
    onEdgeEnter: (index) => showTooltip(index),
    onEdgeLeave: () => state.pinnedEdge === null && hideTooltip(),
    onEdgeTap: (index, event) => togglePinnedTooltip(index, event),
  });

  let worker = null;
  let workerUrl = null;
  let workerRequest = 0;

  function edgeKey(winner, loser) {
    return `${winner}>${loser}`;
  }

  function buildGraph(data) {
    const indexOf = new Map(data.teams.map((slug, index) => [slug, index]));
    const evidence = new Map();
    const beats = new Uint32Array(data.teams.length);
    for (const match of data.played) {
      const result = winsOf(match);
      if (!result) continue;
      const key = edgeKey(result.winner, result.loser);
      if (!evidence.has(key)) evidence.set(key, []);
      evidence.get(key).push(match);
      beats[indexOf.get(result.winner)] |= 1 << indexOf.get(result.loser);
    }
    return { teams: data.teams, beats, evidence };
  }

  function cycleEdges(slugs) {
    return slugs.map((from, index) => ({ from, to: slugs[(index + 1) % slugs.length] }));
  }

  function isBackedCycle(slugs, graph) {
    if (slugs.length < 3 || new Set(slugs).size !== slugs.length) return false;
    return cycleEdges(slugs).every(({ from, to }) => (graph.evidence.get(edgeKey(from, to)) ?? []).length > 0);
  }

  function circleForSlugs(slugs, graph) {
    if (!slugs.every(Boolean) || !isBackedCycle(slugs, graph)) return null;
    const edges = cycleEdges(slugs).map((edge) => ({ ...edge, matches: graph.evidence.get(edgeKey(edge.from, edge.to)) }));
    return { slugs, edges };
  }

  function toCircles(cycles, graph) {
    return cycles.map((cycle) => circleForSlugs(cycle.map((index) => graph.teams[index]), graph)).filter(Boolean);
  }

  function rotationKey(slugs) {
    const start = slugs.indexOf([...slugs].sort()[0]);
    return [...slugs.slice(start), ...slugs.slice(0, start)].join(",");
  }

  const LINK_OFFSET = 36n ** 7n;

  function circleLink(slugs, teams) {
    const order = rotationKey(slugs).split(",").map((slug) => teams.indexOf(slug));
    const available = teams.map((_, index) => index);
    let value = 0n;
    for (const index of order) {
      const position = available.indexOf(index);
      value = value * BigInt(available.length) + BigInt(position);
      available.splice(position, 1);
    }
    value = value * BigInt(teams.length + 1) + BigInt(order.length);
    return (value + LINK_OFFSET).toString(36);
  }

  function slugsFromLink(link, teams) {
    if (!link || !/^[0-9a-z]{8,16}$/.test(link)) return null;
    let value = [...link].reduce((total, digit) => total * 36n + BigInt(parseInt(digit, 36)), 0n) - LINK_OFFSET;
    const length = Number(value % BigInt(teams.length + 1));
    value /= BigInt(teams.length + 1);
    if (value < 0n || length < 3 || length > teams.length) return null;
    const positions = [];
    for (let step = length - 1; step >= 0; step--) {
      const radix = BigInt(teams.length - step);
      positions[step] = Number(value % radix);
      value /= radix;
    }
    if (value !== 0n) return null;
    const available = [...teams];
    return positions.map((position) => available.splice(position, 1)[0]);
  }

  function workerScriptUrl() {
    workerUrl ??= URL.createObjectURL(new Blob([circleWorkerSource()], { type: "text/javascript" }));
    return workerUrl;
  }

  function freshWorker() {
    if (worker) worker.terminate();
    try {
      worker = new Worker(workerScriptUrl());
    } catch {
      worker = null;
    }
    return worker;
  }

  function stopWorker() {
    if (worker) worker.terminate();
    worker = null;
  }

  function validGenerated(cycle, beats) {
    return cycle && CircleSearch.isValidCycle(cycle, beats) ? cycle : null;
  }

  function openSearchOnMainThread(graph) {
    return new Promise((resolve) =>
      setTimeout(() => {
        const session = CircleSearch.openCircleSession(graph.beats);
        const cycles = session.complete ? session.cycles.filter((cycle) => CircleSearch.isValidCycle(cycle, graph.beats)) : [];
        const generate = async (seed) => validGenerated(session.generate(seed), graph.beats);
        resolve({ longest: session.longest, complete: session.complete, cycles, generate });
      }, 50),
    );
  }

  function workerChannel(active, onProgress) {
    const pending = new Map();
    active.onmessage = ({ data }) => {
      if (data.type === "progress") return onProgress(data.phase, data.fraction);
      const waiting = pending.get(data.requestId);
      if (!waiting) return;
      pending.delete(data.requestId);
      if (data.type === "error") waiting.reject(new Error(data.message));
      else waiting.resolve(data);
    };
    return (message) =>
      new Promise((resolve, reject) => {
        const requestId = ++workerRequest;
        pending.set(requestId, { resolve, reject });
        active.postMessage({ ...message, requestId });
      });
  }

  async function openSearchInWorker(active, graph, onProgress) {
    const request = workerChannel(active, onProgress);
    const opened = await request({ type: "open", beats: Array.from(graph.beats) });
    const generate = async (seed) => (await request({ type: "generate", seed })).cycle;
    return { longest: opened.longest, complete: opened.complete, cycles: opened.cycles, generate };
  }

  function openSearch(graph, onProgress) {
    const active = freshWorker();
    if (!active) return openSearchOnMainThread(graph);
    return new Promise((resolve, reject) => {
      active.onerror = (event) => {
        event.preventDefault();
        resolve(openSearchOnMainThread(graph));
      };
      openSearchInWorker(active, graph, onProgress).then(resolve, reject);
    });
  }

  function setLoading(message, fraction = null) {
    elements.loading.hidden = message === null;
    elements.figure.classList.toggle("is-loading", message !== null);
    if (message === null) return;
    elements.loadingText.textContent = message;
    elements.progressBar.style.width = fraction === null ? "0%" : `${Math.round(fraction * 100)}%`;
    elements.progressBar.parentElement.classList.toggle("is-indeterminate", fraction === null);
  }

  function reportSearchProgress(phase, fraction) {
    if (phase === "search") setLoading(`Searching every subset of teams… ${Math.round(fraction * 100)}%`, fraction);
    else setLoading("Collecting the longest circles…", 1);
  }

  function showEmpty(message) {
    elements.empty.hidden = message === null;
    elements.empty.textContent = message ?? "";
  }

  function showNotice(lines) {
    elements.notice.hidden = lines.length === 0;
    elements.notice.textContent = lines.join(" ");
  }

  function seasonName(season) {
    return season.replace("-", "–");
  }

  function renderStats(entries) {
    const items = entries.map(([label, value]) => {
      const pair = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      detail.textContent = value;
      pair.append(term, detail);
      return pair;
    });
    elements.summary.replaceChildren(...items);
  }

  function seasonStats() {
    const { data, longest, circles, generative } = state;
    return [
      ["Season", seasonName(data.season)],
      ["Longest circle", longest > 0 ? `${longest} of ${data.teams.length} teams` : "None yet"],
      ["Circles found", generative ? "More than 2,000" : formatCount(circles.length)],
      ["Played", `${formatCount(data.played.length)} / ${formatCount(data.scheduled)}`],
    ];
  }

  function noticeLines(data) {
    return data.check.warnings.map((warning) => `Data check: ${warning}`);
  }

  function populateSeasons() {
    for (const season of listSeasons()) {
      const option = new Option(seasonName(season), season);
      elements.seasonSelect.append(option);
    }
  }

  function markUnavailable(season) {
    const option = [...elements.seasonSelect.options].find((item) => item.value === season);
    if (option) {
      option.textContent = `${seasonName(season)} (unavailable)`;
      option.disabled = true;
    }
  }

  async function dropIfStale(season) {
    const cached = seasonData.get(season);
    const now = Date.now();
    if (!cached || now - (lastFreshnessCheck.get(season) ?? 0) < FRESHNESS_CHECK_MS) return false;
    lastFreshnessCheck.set(season, now);
    const data = await cached.catch(() => null);
    if (!data || seasonData.get(season) !== cached || !(await hasNewResults(data))) return false;
    seasonData.delete(season);
    seasonResults.delete(season);
    return true;
  }

  async function refreshIfStale() {
    const season = state.season;
    if (document.hidden || state.data?.season !== season) return;
    const viewing = state.visible[state.position];
    if ((await dropIfStale(season)) && state.season === season) selectSeason(season, viewing ? circleLink(viewing.slugs, state.data.teams) : null, true);
  }

  async function fetchSeasonData(season) {
    await dropIfStale(season);
    if (!seasonData.has(season)) {
      lastFreshnessCheck.set(season, Date.now());
      const request = loadSeason(season).catch((error) => {
        seasonData.delete(season);
        throw error;
      });
      seasonData.set(season, request);
    }
    return seasonData.get(season);
  }

  async function fetchSeasonSearch(season, graph) {
    if (seasonResults.has(season)) {
      stopWorker();
      return seasonResults.get(season);
    }
    const search = await openSearch(graph, reportSearchProgress);
    if (search.complete) seasonResults.set(season, search);
    return search;
  }

  function resetView() {
    hideTooltip();
    state.circles = [];
    state.search = null;
    state.generative = false;
    state.generating = false;
    state.seen = new Set();
    state.visible = [];
    state.longest = 0;
    state.position = 0;
    elements.chain.replaceChildren();
    elements.counter.textContent = "–";
    updatePagerButtons();
  }

  function rememberInUrl(season, code = null) {
    history.replaceState(null, "", code ? `#${season}/${code}` : `#${season}`);
  }

  async function selectSeason(season, requestedCode = null, refreshed = false) {
    const token = ++state.loadToken;
    state.season = season;
    rememberInUrl(season);
    resetView();
    showEmpty(null);
    showNotice([]);
    renderStats([["Season", seasonName(season)], ["Status", "Loading results…"]]);
    setLoading("Fetching match results…");
    try {
      const data = await fetchSeasonData(season);
      if (token !== state.loadToken) return;
      await showSeason(data, token, requestedCode, refreshed);
    } catch (error) {
      if (token !== state.loadToken) return;
      showSeasonError(season, error);
    }
  }

  function circleNotice(kept, refreshed) {
    const lines = refreshed ? ["Updated with the latest results."] : [];
    if (!kept) lines.push(refreshed ? "The circle you were viewing is no longer one of the longest, so here is another." : "The circle in this link is no longer one of the longest this season, so here is another.");
    return lines;
  }

  async function showSeason(data, token, requestedCode, refreshed) {
    if (data.teams.length > 24) throw new Error("This season has more teams than the search can handle.");
    state.data = data;
    state.graph = buildGraph(data);
    renderMatchList();
    loadCrests(data.teams, rememberCrest);
    setLoading("Searching every subset of teams…", 0);
    const search = await fetchSeasonSearch(data.season, state.graph);
    if (token !== state.loadToken) return;
    state.search = search;
    state.generative = !search.complete;
    state.circles = toCircles(search.cycles, state.graph);
    state.longest = state.generative || state.circles.length ? search.longest : 0;
    setLoading(null);
    renderStats(seasonStats());
    showNotice(noticeLines(data));
    const kept = await showCircles(requestedCode);
    if (token === state.loadToken) showNotice([...circleNotice(kept, refreshed), ...noticeLines(data)]);
  }

  function showSeasonError(season, error) {
    const fetchFailed = !state.data || state.data.season !== season;
    if (fetchFailed) markUnavailable(season);
    setLoading(null);
    ring.clear();
    state.data = null;
    renderStats([["Season", seasonName(season)], ["Status", fetchFailed ? "Unavailable" : "Error"]]);
    elements.matchCount.textContent = "";
    elements.matchGroups.replaceChildren();
    showEmpty(fetchFailed ? `Couldn't load results for ${seasonName(season)}. The data source may be down or missing this season. Pick another season.` : `Something went wrong: ${error.message}`);
  }

  function rememberCrest(slug, url) {
    crestUrls.set(slug, url);
    ring.setCrest(slug, url);
  }

  async function showCircles(requested) {
    state.position = 0;
    const wanted = slugsFromLink(requested, state.data.teams);
    if (!state.generative) {
      state.visible = state.circles;
      const index = wanted ? state.circles.findIndex((circle) => rotationKey(circle.slugs) === rotationKey(wanted)) : -1;
      state.position = Math.max(index, 0);
      renderCurrent();
      return !wanted || index >= 0;
    }
    state.visible = [];
    const kept = wanted?.length === state.longest ? circleForSlugs(wanted, state.graph) : null;
    if (!kept) {
      await appendGenerated(codeToSeed(requested));
      return !wanted;
    }
    state.seen.add(rotationKey(kept.slugs));
    state.visible.push(kept);
    renderCurrent();
    return true;
  }

  function randomSeed() {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }

  function codeToSeed(code) {
    if (!code || !/^[0-9a-z]{1,7}$/.test(code)) return null;
    const seed = parseInt(code, 36);
    return seed <= 0xffffffff ? seed : null;
  }

  async function generateFresh(requestedSeed) {
    const attempts = 24;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const seed = attempt === 0 && requestedSeed !== null ? requestedSeed : randomSeed();
      const cycle = await state.search.generate(seed);
      const circle = cycle ? toCircles([cycle], state.graph)[0] : null;
      if (!circle) continue;
      const key = rotationKey(circle.slugs);
      if (state.seen.has(key) && attempt < attempts - 1) continue;
      state.seen.add(key);
      return circle;
    }
    return null;
  }

  async function appendGenerated(requestedSeed = null) {
    if (state.generating) return;
    state.generating = true;
    const token = state.loadToken;
    try {
      const circle = await generateFresh(requestedSeed);
      if (token !== state.loadToken || !circle) return;
      state.visible.push(circle);
      state.position = state.visible.length - 1;
      renderCurrent();
    } finally {
      state.generating = false;
    }
  }

  function emptyMessage() {
    if (!state.data) return null;
    return "No circle yet. Not enough matches have had a winner to close a loop of three or more teams.";
  }

  function renderCurrent() {
    hideTooltip();
    const circle = state.visible[state.position];
    if (!circle) {
      ring.clear();
      elements.chain.replaceChildren();
      showEmpty(emptyMessage());
    } else {
      showEmpty(null);
      ring.show(circle.slugs);
      renderChain(circle);
      elements.ring.setAttribute("aria-label", `Circle of ${circle.slugs.length} teams: ${circle.slugs.map(teamName).join(", ")}`);
    }
    if (state.season) rememberInUrl(state.season, circle && state.data ? circleLink(circle.slugs, state.data.teams) : null);
    renderCounter();
    updatePagerButtons();
  }

  function renderCounter() {
    const total = state.visible.length;
    if (state.generative) elements.counter.textContent = total ? `Circle ${formatCount(state.position + 1)}` : "–";
    else elements.counter.textContent = total ? `${formatCount(state.position + 1)} / ${formatCount(total)}` : "0 / 0";
  }

  function updatePagerButtons() {
    const hasCircle = Boolean(state.visible[state.position]);
    const browsable = state.generative ? hasCircle : state.visible.length > 1;
    elements.prev.disabled = state.generative ? state.position === 0 : !browsable;
    elements.next.disabled = !browsable;
    elements.random.disabled = !browsable;
    elements.random.textContent = state.generative ? "New circle" : "Random";
    elements.saveImage.disabled = !hasCircle;
    elements.copyImage.disabled = !hasCircle;
  }

  function imageDetails() {
    const circle = state.visible[state.position];
    const label = state.generative ? "" : ` · circle ${formatCount(state.position + 1)} of ${formatCount(state.visible.length)}`;
    const pageUrl = /^https?:$/.test(location.protocol) ? location.origin + location.pathname : "";
    const link = pageUrl && `${pageUrl}#${state.data.season}/${circleLink(circle.slugs, state.data.teams)}`;
    return {
      subtitle: `${seasonName(state.data.season)} · ${circle.slugs.length} of ${state.data.teams.length} teams${label}`,
      footer: link || "Results: openfootball · ESPN · Crests: Wikipedia",
      fileName: `circle-of-victory-${state.data.season}-${state.position + 1}.png`,
    };
  }

  function currentImage() {
    return renderCircleImage(state.visible[state.position], crestUrls, imageDetails());
  }

  function flashButton(button, message, { sticky = false } = {}) {
    const original = button.dataset.label ?? button.textContent;
    button.dataset.label = original;
    button.textContent = message;
    clearTimeout(Number(button.dataset.timer));
    if (!sticky) button.dataset.timer = String(setTimeout(() => (button.textContent = original), 2000));
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function prefersShareSheet() {
    return window.matchMedia("(pointer: coarse)").matches && typeof navigator.share === "function";
  }

  async function shareFile(blob, fileName) {
    const file = new File([blob], fileName, { type: "image/png" });
    if (!navigator.canShare?.({ files: [file] })) return false;
    try {
      await navigator.share({ files: [file], title: "Circle of Victory" });
      return true;
    } catch (error) {
      return error?.name === "AbortError";
    }
  }

  async function saveImage() {
    if (!state.visible[state.position]) return;
    const { fileName } = imageDetails();
    flashButton(elements.saveImage, "Drawing…", { sticky: true });
    try {
      const blob = await currentImage();
      if (prefersShareSheet() && (await shareFile(blob, fileName))) return flashButton(elements.saveImage, "Shared");
      downloadBlob(blob, fileName);
      flashButton(elements.saveImage, "Saved");
    } catch {
      flashButton(elements.saveImage, "Couldn't save");
    }
  }

  function canCopyImages() {
    return typeof ClipboardItem === "function" && typeof navigator.clipboard?.write === "function";
  }

  async function copyImage() {
    if (!state.visible[state.position]) return;
    flashButton(elements.copyImage, "Drawing…", { sticky: true });
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": currentImage() })]);
      flashButton(elements.copyImage, "Copied");
    } catch {
      flashButton(elements.copyImage, "Couldn't copy");
    }
  }

  function cell(className, lines) {
    const element = document.createElement("td");
    element.className = className;
    for (const line of lines) {
      const part = document.createElement("span");
      part.textContent = line;
      element.append(part);
    }
    return element;
  }

  function chainRow(edge, index) {
    const row = document.createElement("tr");
    row.dataset.index = String(index);
    row.append(
      cell("col-index", [String(index + 1)]),
      cell("col-team", [teamName(edge.from)]),
      cell("col-score", edge.matches.map((match) => winnerScore(match, edge.from))),
      cell("col-team", [teamName(edge.to)]),
      cell("col-date", edge.matches.map((match) => formatDate(match.date))),
    );
    row.addEventListener("pointerenter", () => highlightEdge(index));
    row.addEventListener("pointerleave", () => highlightEdge(null));
    return row;
  }

  function renderChain(circle) {
    elements.chain.replaceChildren(...circle.edges.map(chainRow));
  }

  function highlightEdge(index) {
    elements.ring.querySelectorAll(".edge").forEach((node) => node.classList.toggle("is-active", node.dataset.index === String(index)));
    elements.chain.querySelectorAll("tr").forEach((row) => row.classList.toggle("is-active", row.dataset.index === String(index)));
  }

  function stepThroughHistory(offset) {
    const target = state.position + offset;
    if (target < 0) return;
    if (target >= state.visible.length) return appendGenerated();
    state.position = target;
    renderCurrent();
  }

  function step(offset) {
    if (state.generative) return stepThroughHistory(offset);
    const total = state.visible.length;
    if (total < 2) return;
    state.position = (state.position + offset + total) % total;
    renderCurrent();
  }

  function jumpRandom() {
    if (state.generative) return appendGenerated();
    const total = state.visible.length;
    if (total < 2) return;
    const pick = Math.floor(Math.random() * (total - 1));
    state.position = pick >= state.position ? pick + 1 : pick;
    renderCurrent();
  }

  function tooltipContent(edge) {
    const heading = document.createElement("strong");
    heading.textContent = `${teamName(edge.from)} beat ${teamName(edge.to)}`;
    const lines = edge.matches.map((match) => {
      const line = document.createElement("span");
      line.textContent = matchSummary(match);
      return line;
    });
    return [heading, ...lines];
  }

  function positionTooltip(index) {
    const target = elements.ring.querySelector(`.edge[data-index="${index}"] .edge-line`);
    if (!target) return;
    const box = target.getBoundingClientRect();
    const frame = elements.figure.getBoundingClientRect();
    const tip = elements.tooltip;
    const left = box.left + box.width / 2 - frame.left;
    const top = box.top + box.height / 2 - frame.top;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.min(Math.max(left, half + 4), frame.width - half - 4)}px`;
    tip.style.top = `${top}px`;
    tip.classList.toggle("below", top < tip.offsetHeight + 16);
  }

  function showTooltip(index) {
    const edge = state.visible[state.position]?.edges[index];
    if (!edge) return;
    elements.tooltip.replaceChildren(...tooltipContent(edge));
    elements.tooltip.hidden = false;
    positionTooltip(index);
    highlightEdge(index);
  }

  function hideTooltip() {
    state.pinnedEdge = null;
    elements.tooltip.hidden = true;
    highlightEdge(null);
  }

  function togglePinnedTooltip(index, event) {
    event.stopPropagation();
    if (state.pinnedEdge === index) return hideTooltip();
    showTooltip(index);
    state.pinnedEdge = index;
  }

  function groupByDate(matches) {
    const groups = new Map();
    for (const match of [...matches].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)) {
      if (!groups.has(match.date)) groups.set(match.date, []);
      groups.get(match.date).push(match);
    }
    return groups;
  }

  function matchSide(className, text, isWinner) {
    const side = document.createElement("span");
    side.className = isWinner ? `${className} is-winner` : className;
    side.textContent = text;
    return side;
  }

  function matchRow(match) {
    const row = document.createElement("li");
    row.className = "match-row";
    const winner = winsOf(match)?.winner;
    row.append(
      matchSide("match-home", teamName(match.home), winner === match.home),
      matchSide("match-score", `${match.homeGoals}–${match.awayGoals}`, false),
      matchSide("match-away", teamName(match.away), winner === match.away),
    );
    return row;
  }

  function dateGroup(date, matches) {
    const section = document.createElement("section");
    section.className = "match-day";
    const heading = document.createElement("h3");
    heading.textContent = formatLongDate(date);
    const list = document.createElement("ul");
    list.append(...matches.map(matchRow));
    section.append(heading, list);
    return section;
  }

  function renderMatchList() {
    const { played } = state.data;
    elements.matchCount.textContent = `(${formatCount(played.length)})`;
    elements.matchGroups.replaceChildren();
    if (elements.matchList.open) fillMatchList();
  }

  function fillMatchList() {
    if (!state.data || elements.matchGroups.childElementCount > 0) return;
    const groups = groupByDate(state.data.played);
    if (groups.size === 0) {
      elements.matchGroups.textContent = "No matches have been played yet.";
      return;
    }
    elements.matchGroups.replaceChildren(...[...groups].map(([date, matches]) => dateGroup(date, matches)));
  }

  function isTypingTarget(target) {
    return target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);
  }

  function handleKeys(event) {
    if (isTypingTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft") step(-1);
    else if (event.key === "ArrowRight") step(1);
    else if (event.key === "Escape") hideTooltip();
    else return;
    event.preventDefault();
  }

  function enableSwipe(surface) {
    let origin = null;
    surface.addEventListener("pointerdown", (event) => {
      origin = event.pointerType === "mouse" ? null : { x: event.clientX, y: event.clientY };
    });
    surface.addEventListener("pointerup", (event) => {
      if (!origin) return;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      origin = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    });
    surface.addEventListener("pointercancel", () => {
      origin = null;
    });
  }

  function effectiveTheme() {
    const chosen = document.documentElement.dataset.theme;
    if (chosen) return chosen;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function labelThemeToggle() {
    elements.themeToggle.textContent = effectiveTheme() === "dark" ? "Light" : "Dark";
  }

  function toggleTheme() {
    document.documentElement.dataset.theme = effectiveTheme() === "dark" ? "light" : "dark";
    labelThemeToggle();
  }

  function initialLocation() {
    const [season, code = null] = decodeURIComponent(location.hash.slice(1)).split("/");
    const seasons = listSeasons();
    return seasons.includes(season) ? { season, code } : { season: seasons[0], code: null };
  }

  function bindEvents() {
    elements.seasonSelect.addEventListener("change", () => selectSeason(elements.seasonSelect.value));
    elements.prev.addEventListener("click", () => step(-1));
    elements.next.addEventListener("click", () => step(1));
    elements.random.addEventListener("click", jumpRandom);
    elements.saveImage.addEventListener("click", saveImage);
    elements.copyImage.addEventListener("click", copyImage);
    elements.themeToggle.addEventListener("click", toggleTheme);
    elements.matchList.addEventListener("toggle", fillMatchList);
    document.addEventListener("keydown", handleKeys);
    document.addEventListener("visibilitychange", refreshIfStale);
    document.addEventListener("click", () => state.pinnedEdge !== null && hideTooltip());
    window.addEventListener("resize", () => !elements.tooltip.hidden && hideTooltip());
    enableSwipe(elements.figure);
  }

  function start() {
    populateSeasons();
    labelThemeToggle();
    elements.copyImage.hidden = !canCopyImages();
    bindEvents();
    const { season, code } = initialLocation();
    elements.seasonSelect.value = season;
    selectSeason(season, code);
  }

  start();
})();
