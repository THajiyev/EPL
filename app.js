(() => {
  const { listSeasons, loadSeason, winsOf } = CircleMatches;
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

  const state = {
    season: null,
    data: null,
    graph: null,
    circles: [],
    capped: false,
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

  function toCircles(cycles, graph) {
    const circles = [];
    for (const cycle of cycles) {
      const slugs = cycle.map((index) => graph.teams[index]);
      if (!slugs.every(Boolean) || !isBackedCycle(slugs, graph)) continue;
      const edges = cycleEdges(slugs).map((edge) => ({ ...edge, matches: graph.evidence.get(edgeKey(edge.from, edge.to)) }));
      circles.push({ slugs, edges });
    }
    return circles;
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

  function searchOnMainThread(graph) {
    const result = CircleSearch.findLongestCycles(graph.beats);
    return { ...result, cycles: result.cycles.filter((cycle) => CircleSearch.isValidCycle(cycle, graph.beats)) };
  }

  function searchAfterPaint(graph) {
    return new Promise((resolve) => setTimeout(() => resolve(searchOnMainThread(graph)), 50));
  }

  function computeCircles(graph, onProgress) {
    const active = freshWorker();
    if (!active) return searchAfterPaint(graph);
    return new Promise((resolve, reject) => {
      const requestId = ++workerRequest;
      active.onmessage = ({ data }) => {
        if (data.type === "progress") onProgress(data.phase, data.fraction);
        else if (data.requestId !== requestId) return;
        else if (data.type === "result") resolve(data);
        else reject(new Error(data.message));
      };
      active.onerror = (event) => {
        event.preventDefault();
        resolve(searchAfterPaint(graph));
      };
      active.postMessage({ requestId, beats: Array.from(graph.beats) });
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
    const { data, longest, circles, capped } = state;
    return [
      ["Season", seasonName(data.season)],
      ["Longest circle", longest > 0 ? `${longest} of ${data.teams.length} teams` : "None yet"],
      ["Circles found", capped ? `${formatCount(circles.length)}+ (sample)` : formatCount(circles.length)],
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

  function fetchSeasonData(season) {
    if (!seasonData.has(season)) {
      const request = loadSeason(season).catch((error) => {
        seasonData.delete(season);
        throw error;
      });
      seasonData.set(season, request);
    }
    return seasonData.get(season);
  }

  async function fetchSeasonResult(season, graph) {
    if (!seasonResults.has(season)) seasonResults.set(season, await computeCircles(graph, reportSearchProgress));
    return seasonResults.get(season);
  }

  function resetView() {
    hideTooltip();
    state.circles = [];
    state.visible = [];
    state.longest = 0;
    state.capped = false;
    state.position = 0;
    elements.chain.replaceChildren();
    elements.counter.textContent = "–";
    updatePagerButtons();
  }

  function rememberSeasonInUrl(season) {
    history.replaceState(null, "", `#${season}`);
  }

  async function selectSeason(season) {
    const token = ++state.loadToken;
    state.season = season;
    rememberSeasonInUrl(season);
    resetView();
    showEmpty(null);
    showNotice([]);
    renderStats([["Season", seasonName(season)], ["Status", "Loading results…"]]);
    setLoading("Fetching match results…");
    try {
      const data = await fetchSeasonData(season);
      if (token !== state.loadToken) return;
      await showSeason(data, token);
    } catch (error) {
      if (token !== state.loadToken) return;
      showSeasonError(season, error);
    }
  }

  async function showSeason(data, token) {
    if (data.teams.length > 24) throw new Error("This season has more teams than the search can handle.");
    state.data = data;
    state.graph = buildGraph(data);
    renderMatchList();
    loadCrests(data.teams, rememberCrest);
    setLoading("Searching every subset of teams…", 0);
    const result = await fetchSeasonResult(data.season, state.graph);
    if (token !== state.loadToken) return;
    state.circles = toCircles(result.cycles, state.graph);
    state.longest = state.circles.length ? result.longest : 0;
    state.capped = result.capped;
    setLoading(null);
    renderStats(seasonStats());
    showNotice(noticeLines(data));
    showCircles();
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

  function showCircles() {
    state.visible = state.circles;
    state.position = 0;
    renderCurrent();
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
    renderCounter();
    updatePagerButtons();
  }

  function renderCounter() {
    const total = state.visible.length;
    elements.counter.textContent = total ? `${formatCount(state.position + 1)} / ${formatCount(total)}${state.capped ? "+" : ""}` : "0 / 0";
  }

  function updatePagerButtons() {
    const browsable = state.visible.length > 1;
    elements.prev.disabled = !browsable;
    elements.next.disabled = !browsable;
    elements.random.disabled = !browsable;
    const hasCircle = Boolean(state.visible[state.position]);
    elements.saveImage.disabled = !hasCircle;
    elements.copyImage.disabled = !hasCircle;
  }

  function imageDetails() {
    const total = `${formatCount(state.visible.length)}${state.capped ? "+" : ""}`;
    const circle = state.visible[state.position];
    const pageUrl = /^https?:$/.test(location.protocol) ? location.origin + location.pathname : "";
    return {
      subtitle: `${seasonName(state.data.season)} · ${circle.slugs.length} of ${state.data.teams.length} teams · circle ${formatCount(state.position + 1)} of ${total}`,
      footer: pageUrl || "Results: openfootball · Crests: Wikipedia",
      fileName: `circle-of-victory-${state.data.season}-${state.position + 1}.png`,
    };
  }

  function currentImage() {
    return renderCircleImage(state.visible[state.position], crestUrls, imageDetails());
  }

  function flashButton(button, message) {
    const original = button.dataset.label ?? button.textContent;
    button.dataset.label = original;
    button.textContent = message;
    clearTimeout(Number(button.dataset.timer));
    button.dataset.timer = String(setTimeout(() => (button.textContent = original), 2000));
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
    flashButton(elements.saveImage, "Drawing…");
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
    flashButton(elements.copyImage, "Drawing…");
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

  function step(offset) {
    const total = state.visible.length;
    if (total < 2) return;
    state.position = (state.position + offset + total) % total;
    renderCurrent();
  }

  function jumpRandom() {
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

  function initialSeason() {
    const fromUrl = decodeURIComponent(location.hash.slice(1));
    const seasons = listSeasons();
    return seasons.includes(fromUrl) ? fromUrl : seasons[0];
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
    document.addEventListener("click", () => state.pinnedEdge !== null && hideTooltip());
    window.addEventListener("resize", () => !elements.tooltip.hidden && hideTooltip());
    enableSwipe(elements.figure);
  }

  function start() {
    populateSeasons();
    labelThemeToggle();
    elements.copyImage.hidden = !canCopyImages();
    bindEvents();
    const season = initialSeason();
    elements.seasonSelect.value = season;
    selectSeason(season);
  }

  start();
})();
