const CircleTeams = (() => {
  const CLUBS = [
    ["arsenal", "Arsenal", "ARS", "Arsenal F.C.", "#ef0107", "#ffffff", []],
    ["aston-villa", "Aston Villa", "AVL", "Aston Villa F.C.", "#670e36", "#95bfe5", []],
    ["barnsley", "Barnsley", "BAR", "Barnsley F.C.", "#d71920", "#ffffff", []],
    ["birmingham", "Birmingham", "BIR", "Birmingham City F.C.", "#0000ff", "#ffffff", []],
    ["blackburn", "Blackburn", "BLB", "Blackburn Rovers F.C.", "#009ee0", "#ffffff", []],
    ["blackpool", "Blackpool", "BLP", "Blackpool F.C.", "#f68712", "#ffffff", []],
    ["bolton", "Bolton", "BOL", "Bolton Wanderers F.C.", "#263c7e", "#ffffff", []],
    ["bournemouth", "Bournemouth", "BOU", "AFC Bournemouth", "#da291c", "#000000", []],
    ["bradford", "Bradford", "BRA", "Bradford City A.F.C.", "#7a0026", "#f9b522", ["bradford"]],
    ["brentford", "Brentford", "BRE", "Brentford F.C.", "#e30613", "#ffffff", []],
    ["brighton", "Brighton", "BHA", "Brighton & Hove Albion F.C.", "#0057b8", "#ffffff", ["brighton and hove albion"]],
    ["burnley", "Burnley", "BUR", "Burnley F.C.", "#6c1d45", "#99d6ea", []],
    ["cardiff", "Cardiff", "CAR", "Cardiff City F.C.", "#0070b5", "#ffffff", []],
    ["charlton", "Charlton", "CHA", "Charlton Athletic F.C.", "#d4021d", "#ffffff", []],
    ["chelsea", "Chelsea", "CHE", "Chelsea F.C.", "#034694", "#ffffff", []],
    ["coventry", "Coventry", "COV", "Coventry City F.C.", "#59cbe8", "#000000", ["coventry"]],
    ["crystal-palace", "Crystal Palace", "CRY", "Crystal Palace F.C.", "#1b458f", "#c4122e", []],
    ["derby", "Derby", "DER", "Derby County F.C.", "#ffffff", "#000000", ["derby"]],
    ["everton", "Everton", "EVE", "Everton F.C.", "#003399", "#ffffff", []],
    ["fulham", "Fulham", "FUL", "Fulham F.C.", "#000000", "#ffffff", []],
    ["huddersfield", "Huddersfield", "HUD", "Huddersfield Town A.F.C.", "#0e63ad", "#ffffff", []],
    ["hull", "Hull", "HUL", "Hull City A.F.C.", "#f5a12d", "#000000", []],
    ["ipswich", "Ipswich", "IPS", "Ipswich Town F.C.", "#3a64a3", "#ffffff", []],
    ["leeds", "Leeds", "LEE", "Leeds United F.C.", "#ffcd00", "#1d428a", ["leeds"]],
    ["leicester", "Leicester", "LEI", "Leicester City F.C.", "#003090", "#fdbe11", ["leicester"]],
    ["liverpool", "Liverpool", "LIV", "Liverpool F.C.", "#c8102e", "#ffffff", []],
    ["luton", "Luton", "LUT", "Luton Town F.C.", "#f78f1e", "#002d62", []],
    ["man-city", "Man City", "MCI", "Manchester City F.C.", "#6cabdd", "#1c2c5b", ["man city"]],
    ["man-utd", "Man Utd", "MUN", "Manchester United F.C.", "#da291c", "#fbe122", ["man united", "man utd", "manchester utd"]],
    ["middlesbrough", "Middlesbrough", "MID", "Middlesbrough F.C.", "#e11b22", "#ffffff", []],
    ["newcastle", "Newcastle", "NEW", "Newcastle United F.C.", "#241f20", "#ffffff", ["newcastle utd"]],
    ["norwich", "Norwich", "NOR", "Norwich City F.C.", "#fff200", "#00a650", []],
    ["nottm-forest", "Nott'm Forest", "NFO", "Nottingham Forest F.C.", "#dd0000", "#ffffff", ["nottm forest", "nott'm forest"]],
    ["oldham", "Oldham", "OLD", "Oldham Athletic A.F.C.", "#004a99", "#ffffff", []],
    ["portsmouth", "Portsmouth", "POR", "Portsmouth F.C.", "#001489", "#ffffff", []],
    ["qpr", "QPR", "QPR", "Queens Park Rangers F.C.", "#1d5ba4", "#ffffff", ["qpr"]],
    ["reading", "Reading", "REA", "Reading F.C.", "#004494", "#ffffff", []],
    ["sheffield-utd", "Sheffield Utd", "SHU", "Sheffield United F.C.", "#ee2737", "#000000", ["sheffield utd", "sheff utd"]],
    ["sheffield-wed", "Sheffield Wed", "SHW", "Sheffield Wednesday F.C.", "#0e00f7", "#ffffff", ["sheffield wed", "sheff wed"]],
    ["southampton", "Southampton", "SOU", "Southampton F.C.", "#d71920", "#ffffff", []],
    ["stoke", "Stoke", "STK", "Stoke City F.C.", "#e03a3e", "#ffffff", []],
    ["sunderland", "Sunderland", "SUN", "Sunderland A.F.C.", "#eb172b", "#ffffff", []],
    ["swansea", "Swansea", "SWA", "Swansea City A.F.C.", "#ffffff", "#121212", []],
    ["swindon", "Swindon", "SWI", "Swindon Town F.C.", "#d71921", "#ffffff", []],
    ["tottenham", "Spurs", "TOT", "Tottenham Hotspur F.C.", "#132257", "#ffffff", ["tottenham", "spurs"]],
    ["watford", "Watford", "WAT", "Watford F.C.", "#fbee23", "#000000", []],
    ["west-brom", "West Brom", "WBA", "West Bromwich Albion F.C.", "#122f67", "#ffffff", ["west brom"]],
    ["west-ham", "West Ham", "WHU", "West Ham United F.C.", "#7a263a", "#1bb1e7", ["west ham"]],
    ["wigan", "Wigan", "WIG", "Wigan Athletic F.C.", "#1d59af", "#ffffff", []],
    ["wimbledon", "Wimbledon", "WIM", "Wimbledon F.C.", "#00205b", "#ffd100", []],
    ["wolves", "Wolves", "WOL", "Wolverhampton Wanderers F.C.", "#fdb913", "#231f20", ["wolves"]],
  ];

  const SUFFIX_PATTERN = /\b(a\.?f\.?c\.?|f\.?c\.?)(?=\s|$)/g;

  function cleanName(raw) {
    return raw
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(SUFFIX_PATTERN, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toSlug(text) {
    return text.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function buildClub([slug, name, code, wikiTitle, color, ink, aliases]) {
    return { slug, name, code, wikiTitle, color, ink, aliases };
  }

  const CLUB_BY_SLUG = new Map(CLUBS.map((row) => [row[0], buildClub(row)]));

  function namesFor(club) {
    const fromWiki = cleanName(club.wikiTitle);
    const firstWords = fromWiki.split(" ");
    const withoutLastWord = firstWords.length > 1 ? firstWords.slice(0, -1).join(" ") : fromWiki;
    return [fromWiki, withoutLastWord, cleanName(club.name), club.slug.replace(/-/g, " "), ...club.aliases];
  }

  const SLUG_BY_NAME = new Map();
  for (const club of CLUB_BY_SLUG.values()) {
    for (const name of namesFor(club)) {
      if (!SLUG_BY_NAME.has(name)) SLUG_BY_NAME.set(name, club.slug);
    }
  }

  const unknownClubs = new Map();

  function initialsOf(name) {
    const words = name.split(" ").filter(Boolean);
    const letters = words.length > 1 ? words.map((word) => word[0]).join("") : name.slice(0, 3);
    return letters.slice(0, 3).toUpperCase();
  }

  function registerUnknown(raw) {
    const display = raw.replace(SUFFIX_PATTERN, "").replace(/\s+/g, " ").trim() || raw;
    const slug = toSlug(cleanName(raw)) || "team";
    if (!unknownClubs.has(slug)) {
      unknownClubs.set(slug, buildClub([slug, display, initialsOf(display), null, "#64748b", "#ffffff", []]));
    }
    return slug;
  }

  function slugForTeam(raw) {
    return SLUG_BY_NAME.get(cleanName(raw)) ?? registerUnknown(raw);
  }

  function clubFor(slug) {
    return CLUB_BY_SLUG.get(slug) ?? unknownClubs.get(slug) ?? buildClub([slug, slug, slug.slice(0, 3).toUpperCase(), null, "#64748b", "#ffffff", []]);
  }

  function allKnownClubs() {
    return [...CLUB_BY_SLUG.values()];
  }

  return { slugForTeam, clubFor, allKnownClubs };
})();
