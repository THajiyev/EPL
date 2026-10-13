import { test } from "node:test";
import assert from "node:assert/strict";
import CircleSearch from "../circles.js";

const { buildAdjacency, canonicalRotation, findLongestCycles, isValidCycle, openCircleSession, seededRandom } = CircleSearch;

function graphFrom(teamCount, wins) {
  return { teamCount, wins, beats: buildAdjacency(teamCount, wins) };
}

function assertWellFormed(graph, result) {
  for (const cycle of result.cycles) {
    assert.equal(cycle.length, result.longest);
    assert.equal(new Set(cycle).size, cycle.length, `repeated team in ${cycle}`);
    cycle.forEach((team, index) => {
      const next = cycle[(index + 1) % cycle.length];
      const backed = graph.wins.some(([winner, loser]) => winner === team && loser === next);
      assert.ok(backed, `edge ${team}->${next} has no win behind it`);
    });
    const last = cycle[cycle.length - 1];
    assert.ok(graph.wins.some(([winner, loser]) => winner === last && loser === cycle[0]), "last team must beat first");
    assert.deepEqual(cycle, canonicalRotation(cycle), "cycle must start at its lowest team");
  }
  const keys = result.cycles.map((cycle) => canonicalRotation(cycle).join(","));
  assert.equal(new Set(keys).size, keys.length, "rotations must be deduplicated");
}

function bruteForceCycles(teamCount, beats) {
  const found = new Map();
  const visit = (path, used) => {
    const last = path[path.length - 1];
    if (path.length >= 3 && beats[last] & (1 << path[0])) {
      const key = canonicalRotation(path).join(",");
      found.set(key, path.length);
    }
    for (let next = 0; next < teamCount; next++) {
      if (!(used & (1 << next)) && beats[last] & (1 << next)) visit([...path, next], used | (1 << next));
    }
  };
  for (let start = 0; start < teamCount; start++) visit([start], 1 << start);
  const longest = Math.max(0, ...found.values());
  const keys = [...found].filter(([, size]) => size === longest).map(([key]) => key);
  return { longest, keys: new Set(keys) };
}

function randomGraph(teamCount, seed, winChance = 0.45) {
  const random = seededRandom(seed);
  const wins = [];
  for (let a = 0; a < teamCount; a++) {
    for (let b = 0; b < teamCount; b++) {
      if (a !== b && random() < winChance) wins.push([a, b]);
    }
  }
  return graphFrom(teamCount, wins);
}

test("a single triangle is found once, in its true direction", () => {
  const graph = graphFrom(3, [[0, 1], [1, 2], [2, 0]]);
  const result = findLongestCycles(graph.beats);
  assert.equal(result.longest, 3);
  assert.deepEqual(result.cycles, [[0, 1, 2]]);
  assert.equal(result.capped, false);
  assertWellFormed(graph, result);
});

test("an acyclic graph has no circles", () => {
  const graph = graphFrom(4, [[0, 1], [0, 2], [1, 2], [2, 3], [1, 3]]);
  const result = findLongestCycles(graph.beats);
  assert.equal(result.longest, 0);
  assert.deepEqual(result.cycles, []);
});

test("two-team mutual wins are not a circle", () => {
  const graph = graphFrom(2, [[0, 1], [1, 0]]);
  assert.equal(findLongestCycles(graph.beats).longest, 0);
});

test("longest length beats shorter cycles", () => {
  const graph = graphFrom(5, [[0, 1], [1, 2], [2, 0], [2, 3], [3, 4], [4, 0]]);
  const result = findLongestCycles(graph.beats);
  assert.equal(result.longest, 5);
  assert.deepEqual(result.cycles, [[0, 1, 2, 3, 4]]);
  assertWellFormed(graph, result);
});

test("both directions are kept when both exist, rotations are not", () => {
  const forward = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const backward = forward.map(([a, b]) => [b, a]);
  const graph = graphFrom(4, [...forward, ...backward]);
  const result = findLongestCycles(graph.beats);
  assert.equal(result.longest, 4);
  const keys = result.cycles.map((cycle) => cycle.join(",")).sort();
  assert.deepEqual(keys, ["0,1,2,3", "0,3,2,1"]);
  assertWellFormed(graph, result);
});

test("the lowest team need not be where the search would naturally start", () => {
  const graph = graphFrom(5, [[3, 0], [0, 4], [4, 2], [2, 1], [1, 3]]);
  const result = findLongestCycles(graph.beats);
  assert.equal(result.longest, 5);
  assert.deepEqual(result.cycles, [[0, 4, 2, 1, 3]]);
});

test("matches a brute-force search on random graphs", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const teamCount = 4 + (seed % 5);
    const graph = randomGraph(teamCount, seed);
    const expected = bruteForceCycles(teamCount, graph.beats);
    const result = findLongestCycles(graph.beats);
    assert.equal(result.longest, expected.longest, `seed ${seed}`);
    assert.equal(result.capped, false);
    assertWellFormed(graph, result);
    assert.deepEqual(new Set(result.cycles.map((cycle) => cycle.join(","))), expected.keys, `seed ${seed}`);
  }
});

test("caps large results, reports it, and stays valid and distinct", () => {
  const wins = [];
  for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) if (a !== b) wins.push([a, b]);
  const graph = graphFrom(9, wins);
  const result = findLongestCycles(graph.beats, { limit: 500 });
  assert.equal(result.longest, 9);
  assert.equal(result.capped, true);
  assert.equal(result.cycles.length, 500);
  assertWellFormed(graph, result);
});

test("generated circles are valid, longest, canonical and reproducible from their seed", () => {
  const graph = randomGraph(12, 7, 0.6);
  const session = openCircleSession(graph.beats, { limit: 50 });
  assert.equal(session.complete, false);
  const generated = [];
  for (let seed = 1; seed <= 300; seed++) {
    const cycle = session.generate(seed);
    assert.deepEqual(session.generate(seed), cycle, `seed ${seed} must always give the same circle`);
    generated.push(cycle);
  }
  assertWellFormed(graph, { longest: session.longest, cycles: [...new Map(generated.map((cycle) => [cycle.join(","), cycle])).values()] });
  assert.ok(new Set(generated.map((cycle) => cycle.join(","))).size > 200, "different seeds should give varied circles");
});

test("a small season is listed exactly instead of generated", () => {
  const graph = graphFrom(5, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [2, 0]]);
  const session = openCircleSession(graph.beats);
  assert.equal(session.complete, true);
  assert.deepEqual(session.cycles, [[0, 1, 2, 3, 4]]);
});

test("generating from a season with no circles gives nothing", () => {
  const graph = graphFrom(3, [[0, 1], [1, 2]]);
  const session = openCircleSession(graph.beats);
  assert.equal(session.longest, 0);
  assert.equal(session.generate(42), null);
});

test("handles a 22-team season-sized graph", () => {
  const graph = randomGraph(22, 2024, 0.4);
  const result = findLongestCycles(graph.beats);
  assert.ok(result.longest >= 3 && result.longest <= 22);
  assert.ok(result.cycles.length > 0 && result.cycles.length <= 2000);
  assertWellFormed(graph, result);
});

test("isValidCycle rejects broken cycles", () => {
  const beats = buildAdjacency(4, [[0, 1], [1, 2], [2, 0], [2, 3]]);
  assert.equal(isValidCycle([0, 1, 2], beats), true);
  assert.equal(isValidCycle([0, 2, 1], beats), false);
  assert.equal(isValidCycle([0, 1], beats), false);
  assert.equal(isValidCycle([0, 1, 2, 0], beats), false);
  assert.equal(isValidCycle([1, 2, 3], beats), false);
});
