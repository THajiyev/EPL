const CircleCrests = (() => {
  const { clubFor } = CircleTeams;

  const WIKI_ENDPOINT = "https://en.wikipedia.org/w/api.php";
  const WIKI_BATCH_SIZE = 50;
  const SPORTSDB_ENDPOINT = "https://www.thesportsdb.com/api/v1/json/3/searchteams.php";

  const crestJobs = new Map();
  let sportsDbReachable = true;

  function wikiUrl(titles) {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      prop: "pageimages",
      piprop: "thumbnail",
      pithumbsize: "200",
      pilicense: "any",
      redirects: "1",
      titles: titles.join("|"),
    });
    return `${WIKI_ENDPOINT}?${params}`;
  }

  function chunk(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
    return chunks;
  }

  function resolveTitle(query, title) {
    let resolved = title;
    for (const step of [...(query.normalized ?? []), ...(query.redirects ?? [])]) {
      if (step.from === resolved) resolved = step.to;
    }
    return resolved;
  }

  async function fetchWikiThumbnails(titles) {
    const found = new Map();
    try {
      const response = await fetch(wikiUrl(titles));
      if (!response.ok) return found;
      const { query } = await response.json();
      if (!query?.pages) return found;
      const thumbByTitle = new Map(Object.values(query.pages).map((page) => [page.title, page.thumbnail?.source]));
      for (const title of titles) {
        const source = thumbByTitle.get(resolveTitle(query, title));
        if (source) found.set(title, source);
      }
    } catch {
      return found;
    }
    return found;
  }

  function pickSportsDbTeam(teams, club) {
    const soccer = (teams ?? []).filter((team) => team.strSport === "Soccer" && team.strBadge);
    return soccer.find((team) => team.strCountry === "England" || team.strCountry === "Wales") ?? soccer.find((team) => team.strTeam === club.name) ?? null;
  }

  async function fetchSportsDbBadge(club) {
    if (!sportsDbReachable) return null;
    const searchName = club.wikiTitle ? club.wikiTitle.replace(/\b(A\.F\.C\.|F\.C\.)/g, "").trim() : club.name;
    try {
      const response = await fetch(`${SPORTSDB_ENDPOINT}?t=${encodeURIComponent(searchName)}`);
      if (!response.ok) return null;
      const data = await response.json();
      return pickSportsDbTeam(data?.teams, club)?.strBadge ?? null;
    } catch {
      sportsDbReachable = false;
      return null;
    }
  }

  function imageLoads(url) {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = url;
    });
  }

  async function settleCrest(slug, candidate) {
    if (candidate && (await imageLoads(candidate))) return candidate;
    const badge = await fetchSportsDbBadge(clubFor(slug));
    if (badge && (await imageLoads(badge))) return badge;
    return null;
  }

  function startBatch(slugs) {
    const titles = slugs.map((slug) => clubFor(slug).wikiTitle).filter(Boolean);
    const thumbnails = titles.length ? fetchWikiThumbnails(titles) : Promise.resolve(new Map());
    for (const slug of slugs) {
      const title = clubFor(slug).wikiTitle;
      crestJobs.set(slug, thumbnails.then((found) => settleCrest(slug, found.get(title) ?? null)));
    }
  }

  function loadCrests(slugs, onCrest) {
    const missing = slugs.filter((slug) => !crestJobs.has(slug));
    chunk(missing, WIKI_BATCH_SIZE).forEach(startBatch);
    const deliveries = slugs.map((slug) => crestJobs.get(slug).then((url) => url && onCrest(slug, url)));
    return Promise.all(deliveries);
  }

  return { loadCrests };
})();
