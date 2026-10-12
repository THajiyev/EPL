const CircleFormat = (() => {
  const { clubFor } = CircleTeams;

  const numberFormat = new Intl.NumberFormat("en-GB");
  const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const longDateFormat = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  function formatCount(value) {
    return numberFormat.format(value);
  }

  function parseIsoDate(iso) {
    const date = new Date(`${iso}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(iso) {
    const date = parseIsoDate(iso);
    return date ? `${date.getUTCDate()} ${SHORT_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}` : "date unknown";
  }

  function formatLongDate(iso) {
    const date = parseIsoDate(iso);
    return date ? longDateFormat.format(date) : "Date unknown";
  }

  function teamName(slug) {
    return clubFor(slug).name;
  }

  function scoreline(match) {
    return `${teamName(match.home)} ${match.homeGoals}–${match.awayGoals} ${teamName(match.away)}`;
  }

  function matchSummary(match) {
    return `${scoreline(match)} · ${formatDate(match.date)}`;
  }

  function winnerScore(match, winner) {
    const home = match.home === winner;
    const [mine, theirs] = home ? [match.homeGoals, match.awayGoals] : [match.awayGoals, match.homeGoals];
    return `${mine}–${theirs} ${home ? "H" : "A"}`;
  }

  return { formatCount, formatDate, formatLongDate, teamName, scoreline, matchSummary, winnerScore };
})();
