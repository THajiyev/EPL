const CircleMatches = (() => {
  const { slugForTeam } = CircleTeams;

  const FIRST_SEASON_START = 1992;
  const JSON_SOURCE = (season) => `https://raw.githubusercontent.com/openfootball/football.json/master/${season}/en.1.json`;
  const TEXT_SOURCE = (season) => {
    const startYear = Number(season.slice(0, 4));
    const folder = startYear < 2000 ? `archive/1990s/${season}` : season;
    return `https://raw.githubusercontent.com/openfootball/england/master/${folder}/1-premierleague.txt`;
  };
  const ESPN_SOURCE = (day) => `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=${day.replace(/-/g, "")}`;
  const ESPN_CONCURRENCY = 6;
  const ESPN_ID_OFFSET = 10000;
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const DATE_LINE = /^\s*\[?(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:\s+(\d{4}))?\]?\s*$/i;
  const MATCH_LINE = /^\s*(?:\d{1,2}[:.]\d{2}\s+)?(\S.*?)\s+(\d+)\s*-\s*(\d+)(?:\s*\(\d+\s*-\s*\d+\))?\s+(\S.*?)\s*$/;

  function seasonLabel(startYear) {
    return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  }

  function currentSeasonStart(today = new Date()) {
    return today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1;
  }

  function listSeasons(today = new Date()) {
    const seasons = [];
    for (let year = currentSeasonStart(today); year >= FIRST_SEASON_START; year--) seasons.push(seasonLabel(year));
    return seasons;
  }

  function finalScoreOf(score) {
    if (Array.isArray(score) && score.length === 2) return score;
    if (score && Array.isArray(score.ft) && score.ft.length === 2) return score.ft;
    return null;
  }

  function isRealScore(score) {
    return score !== null && score.every((goals) => Number.isInteger(goals) && goals >= 0);
  }

  function buildMatch(id, date, homeRaw, awayRaw, score) {
    return {
      id,
      date,
      home: slugForTeam(homeRaw),
      away: slugForTeam(awayRaw),
      homeGoals: score[0],
      awayGoals: score[1],
    };
  }

  function parseJsonSeason(data) {
    const fixtures = Array.isArray(data?.matches) ? data.matches : [];
    const played = [];
    fixtures.forEach((fixture, index) => {
      const score = finalScoreOf(fixture.score);
      if (!isRealScore(score) || !fixture.team1 || !fixture.team2) return;
      played.push(buildMatch(index, fixture.date ?? "", fixture.team1, fixture.team2, score));
    });
    const teams = new Set(fixtures.flatMap((fixture) => [fixture.team1, fixture.team2]).filter(Boolean).map(slugForTeam));
    return { played, scheduled: fixtures.length, fixtureTeams: teams };
  }

  function isoDate(year, monthIndex, day) {
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function dateFromLine(match, startYear) {
    const monthIndex = MONTHS.indexOf(match[1].toLowerCase());
    if (monthIndex < 0) return null;
    const year = match[3] ? Number(match[3]) : monthIndex >= 6 ? startYear : startYear + 1;
    return isoDate(year, monthIndex, Number(match[2]));
  }

  function parseTextSeason(text, season) {
    const startYear = Number(season.slice(0, 4));
    const played = [];
    let currentDate = "";
    for (const line of text.split(/\r?\n/)) {
      const dateMatch = line.match(DATE_LINE);
      if (dateMatch) {
        currentDate = dateFromLine(dateMatch, startYear) ?? currentDate;
        continue;
      }
      if (/^\s*[#=▪]/.test(line)) continue;
      const found = line.match(MATCH_LINE);
      if (!found) continue;
      const score = [Number(found[2]), Number(found[3])];
      played.push(buildMatch(played.length, currentDate, found[1], found[4], score));
    }
    return { played, scheduled: played.length, fixtureTeams: new Set(played.flatMap((match) => [match.home, match.away])) };
  }

  async function fetchOrNull(url, read) {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return await read(response);
    } catch {
      return null;
    }
  }

  async function fetchSeasonSource(season) {
    const json = await fetchOrNull(JSON_SOURCE(season), (response) => response.json());
    if (json) return { ...parseJsonSeason(json), source: "football.json" };
    const text = await fetchOrNull(TEXT_SOURCE(season), (response) => response.text());
    if (text) {
      const parsed = parseTextSeason(text, season);
      if (parsed.played.length > 0) return { ...parsed, source: "openfootball/england" };
    }
    return null;
  }

  function daysBetween(fromIso, toIso) {
    const days = [];
    const cursor = new Date(`${fromIso}T00:00:00Z`);
    const end = new Date(`${toIso}T00:00:00Z`);
    for (; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) days.push(cursor.toISOString().slice(0, 10));
    return days;
  }

  function parseEspnDay(data) {
    const results = [];
    for (const event of Array.isArray(data?.events) ? data.events : []) {
      if (!event.status?.type?.completed) continue;
      const sides = event.competitions?.[0]?.competitors ?? [];
      const home = sides.find((side) => side.homeAway === "home");
      const away = sides.find((side) => side.homeAway === "away");
      const score = [Number(home?.score), Number(away?.score)];
      if (!home?.team?.displayName || !away?.team?.displayName || !isRealScore(score)) continue;
      results.push({ date: String(event.date).slice(0, 10), home: home.team.displayName, away: away.team.displayName, score });
    }
    return results;
  }

  async function fetchEspnDays(days) {
    const results = [];
    let next = 0;
    const worker = async () => {
      while (next < days.length) {
        const day = days[next++];
        const data = await fetchOrNull(ESPN_SOURCE(day), (response) => response.json());
        if (data) results.push(...parseEspnDay(data));
      }
    };
    await Promise.all(Array.from({ length: ESPN_CONCURRENCY }, worker));
    return results;
  }

  function localIsoDate(today) {
    return isoDate(today.getFullYear(), today.getMonth(), today.getDate());
  }

  async function addRecentEspnResults(raw, season, today) {
    const seasonStart = `${season.slice(0, 4)}-08-01`;
    const lastKnown = raw.played.reduce((latest, match) => (match.date > latest ? match.date : latest), seasonStart);
    const recent = await fetchEspnDays(daysBetween(lastKnown, localIsoDate(today)));
    const known = new Set(raw.played.map((match) => `${match.home}>${match.away}`));
    const added = [];
    for (const result of recent) {
      const match = buildMatch(ESPN_ID_OFFSET + added.length, result.date, result.home, result.away, result.score);
      const key = `${match.home}>${match.away}`;
      if (known.has(key)) continue;
      known.add(key);
      added.push(match);
    }
    if (added.length === 0) return raw;
    return { ...raw, played: [...raw.played, ...added], source: `${raw.source} + ESPN` };
  }

  function sortedTeams(fixtureTeams, played) {
    const all = new Set(fixtureTeams);
    played.forEach((match) => all.add(match.home).add(match.away));
    return [...all].sort();
  }

  function countMeetings(played) {
    const meetings = new Map();
    for (const match of played) {
      const key = `${match.home}>${match.away}`;
      meetings.set(key, (meetings.get(key) ?? 0) + 1);
    }
    return meetings;
  }

  function checkSeason(teams, played, inProgress) {
    const expected = teams.length * (teams.length - 1);
    const meetings = countMeetings(played);
    const duplicates = [...meetings.values()].filter((count) => count > 1).length;
    const missing = expected - meetings.size;
    const selfMatches = played.filter((match) => match.home === match.away).length;
    const warnings = [];
    if (!inProgress && missing > 0) warnings.push(`${missing} of ${expected} home-and-away meetings look missing from the source data.`);
    if (duplicates > 0) warnings.push(`${duplicates} fixtures appear more than once in the source data.`);
    if (selfMatches > 0) warnings.push(`${selfMatches} matches list the same team on both sides.`);
    if (teams.length !== 20 && teams.length !== 22) warnings.push(`Found ${teams.length} teams; expected 20 or 22.`);
    return { expected, playedPairs: meetings.size, warnings };
  }

  async function loadSeason(season, today = new Date()) {
    const isCurrent = season === seasonLabel(currentSeasonStart(today));
    const fetched = await fetchSeasonSource(season);
    if (!fetched) throw new Error(`No match data could be fetched for ${season}.`);
    const raw = isCurrent ? await addRecentEspnResults(fetched, season, today) : fetched;
    const teams = sortedTeams(raw.fixtureTeams, raw.played);
    const inProgress = isCurrent || raw.played.length < raw.scheduled;
    const played = raw.played.filter((match) => match.home !== match.away);
    return {
      season,
      source: raw.source,
      teams,
      played,
      scheduled: Math.max(raw.scheduled, teams.length * (teams.length - 1)),
      inProgress,
      check: checkSeason(teams, raw.played, inProgress),
    };
  }

  function winsOf(match) {
    if (match.homeGoals > match.awayGoals) return { winner: match.home, loser: match.away };
    if (match.awayGoals > match.homeGoals) return { winner: match.away, loser: match.home };
    return null;
  }

  return { seasonLabel, currentSeasonStart, listSeasons, checkSeason, loadSeason, winsOf };
})();
