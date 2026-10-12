function createCircleSearch() {
  const CYCLE_CAP = 2000;
  const MIN_CYCLE_LENGTH = 3;

  function bitCount(value) {
    let v = value - ((value >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }

  function lowestBitIndex(value) {
    return 31 - Math.clz32(value & -value);
  }

  function bitIndices(value) {
    const indices = [];
    let rest = value >>> 0;
    while (rest) {
      indices.push(lowestBitIndex(rest));
      rest &= rest - 1;
    }
    return indices;
  }

  function buildAdjacency(teamCount, wins) {
    const beats = new Uint32Array(teamCount);
    for (const [winner, loser] of wins) beats[winner] |= 1 << loser;
    return beats;
  }

  function invertAdjacency(beats) {
    const beatenBy = new Uint32Array(beats.length);
    beats.forEach((targets, winner) => {
      for (const loser of bitIndices(targets)) beatenBy[loser] |= 1 << winner;
    });
    return beatenBy;
  }

  function bitsAbove(index) {
    return index >= 31 ? 0 : (~((1 << (index + 1)) - 1)) >>> 0;
  }

  function extendPaths(dp, beats, mask) {
    const start = lowestBitIndex(mask);
    let reachable = 0;
    for (const end of bitIndices(dp[mask])) reachable |= beats[end];
    let fresh = (reachable & ~mask & bitsAbove(start)) >>> 0;
    while (fresh) {
      const next = lowestBitIndex(fresh);
      fresh &= fresh - 1;
      const grown = (mask | (1 << next)) >>> 0;
      dp[grown] |= 1 << next;
    }
  }

  function closesCycle(dp, beatenBy, mask) {
    return (dp[mask] & beatenBy[lowestBitIndex(mask)]) !== 0;
  }

  function buildPathTable(beats, onProgress = () => {}) {
    const teamCount = beats.length;
    const total = 2 ** teamCount;
    const dp = new Uint32Array(total);
    const beatenBy = invertAdjacency(beats);
    for (let team = 0; team < teamCount; team++) dp[1 << team] = 1 << team;
    let longest = 0;
    const reportEvery = Math.max(1, Math.floor(total / 50));
    for (let mask = 1; mask < total; mask++) {
      if (dp[mask] === 0) continue;
      extendPaths(dp, beats, mask);
      const size = bitCount(mask);
      if (size >= MIN_CYCLE_LENGTH && size > longest && closesCycle(dp, beatenBy, mask)) longest = size;
      if (mask % reportEvery === 0) onProgress(mask / total);
    }
    return { dp, beatenBy, longest };
  }

  function cycleMasksOfLength(table, length) {
    const masks = [];
    const { dp, beatenBy } = table;
    for (let mask = 1; mask < dp.length; mask++) {
      if (dp[mask] !== 0 && bitCount(mask) === length && closesCycle(dp, beatenBy, mask)) masks.push(mask);
    }
    return masks;
  }

  function predecessorsOf(table, mask, team) {
    const remaining = (mask & ~(1 << team)) >>> 0;
    return { remaining, options: table.dp[remaining] & table.beatenBy[team] };
  }

  function closingTeams(table, mask) {
    return table.dp[mask] & table.beatenBy[lowestBitIndex(mask)];
  }

  function walkBackExhaustively(table, mask, team, suffix, emit) {
    const start = lowestBitIndex(mask);
    if (team === start) return emit([start, ...suffix]);
    const { remaining, options } = predecessorsOf(table, mask, team);
    for (const previous of bitIndices(options)) {
      if (walkBackExhaustively(table, remaining, previous, [team, ...suffix], emit) === false) return false;
    }
    return true;
  }

  function collectAllCycles(table, masks, limit) {
    const cycles = [];
    const emit = (cycle) => {
      cycles.push(cycle);
      return cycles.length <= limit;
    };
    for (const mask of masks) {
      for (const last of bitIndices(closingTeams(table, mask))) {
        if (walkBackExhaustively(table, mask, last, [], emit) === false) {
          return { cycles: cycles.slice(0, limit), complete: false };
        }
      }
    }
    return { cycles, complete: true };
  }

  function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickRandomBit(value, random) {
    const indices = bitIndices(value);
    return indices[Math.floor(random() * indices.length)];
  }

  function walkBackRandomly(table, mask, random) {
    const start = lowestBitIndex(mask);
    let team = pickRandomBit(closingTeams(table, mask), random);
    let current = mask;
    const reversed = [];
    while (team !== start) {
      reversed.push(team);
      const { remaining, options } = predecessorsOf(table, current, team);
      current = remaining;
      team = pickRandomBit(options, random);
    }
    reversed.push(start);
    return reversed.reverse();
  }

  function sampleCycles(table, masks, limit, seed = 20240813) {
    const random = seededRandom(seed);
    const seen = new Map();
    const maxAttempts = limit * 40;
    for (let attempt = 0; attempt < maxAttempts && seen.size < limit; attempt++) {
      const mask = masks[Math.floor(random() * masks.length)];
      const cycle = walkBackRandomly(table, mask, random);
      const key = cycle.join(",");
      if (!seen.has(key)) seen.set(key, cycle);
    }
    return [...seen.values()];
  }

  function canonicalRotation(cycle) {
    let best = 0;
    cycle.forEach((team, index) => {
      if (team < cycle[best]) best = index;
    });
    return [...cycle.slice(best), ...cycle.slice(0, best)];
  }

  function isValidCycle(cycle, beats) {
    if (!Array.isArray(cycle) || cycle.length < MIN_CYCLE_LENGTH) return false;
    if (new Set(cycle).size !== cycle.length) return false;
    return cycle.every((team, index) => {
      const next = cycle[(index + 1) % cycle.length];
      return team >= 0 && team < beats.length && (beats[team] & (1 << next)) !== 0;
    });
  }

  function findLongestCycles(beats, { limit = CYCLE_CAP, seed, onProgress = () => {} } = {}) {
    if (beats.length > 24) throw new Error("Too many teams for the bitmask search");
    const table = buildPathTable(beats, (fraction) => onProgress("search", fraction));
    if (table.longest === 0) return { longest: 0, cycles: [], capped: false };
    onProgress("collect", 0);
    const masks = cycleMasksOfLength(table, table.longest);
    const exhaustive = collectAllCycles(table, masks, limit);
    const cycles = exhaustive.complete ? exhaustive.cycles : sampleCycles(table, masks, limit, seed);
    onProgress("collect", 1);
    return { longest: table.longest, cycles, capped: !exhaustive.complete };
  }

  return { CYCLE_CAP, MIN_CYCLE_LENGTH, bitCount, lowestBitIndex, bitIndices, buildAdjacency, invertAdjacency, buildPathTable, cycleMasksOfLength, collectAllCycles, seededRandom, sampleCycles, canonicalRotation, isValidCycle, findLongestCycles };
}

const CircleSearch = createCircleSearch();

if (typeof module === "object" && module.exports) module.exports = CircleSearch;
