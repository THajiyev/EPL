function runCircleWorker(search) {
  let session = null;
  let adjacency = null;

  function reportProgress(phase, fraction) {
    self.postMessage({ type: "progress", phase, fraction });
  }

  function openSession(requestId, beats) {
    adjacency = Uint32Array.from(beats);
    session = search.openCircleSession(adjacency, { limit: search.CYCLE_CAP, onProgress: reportProgress });
    const cycles = session.complete ? session.cycles.filter((cycle) => search.isValidCycle(cycle, adjacency)) : [];
    self.postMessage({ type: "opened", requestId, longest: session.longest, complete: session.complete, cycles });
  }

  function generate(requestId, seed) {
    const cycle = session?.generate(seed) ?? null;
    const valid = cycle && search.isValidCycle(cycle, adjacency) ? cycle : null;
    self.postMessage({ type: "generated", requestId, cycle: valid });
  }

  self.onmessage = (event) => {
    const { type, requestId } = event.data;
    try {
      if (type === "open") openSession(requestId, event.data.beats);
      else if (type === "generate") generate(requestId, event.data.seed);
    } catch (error) {
      self.postMessage({ type: "error", requestId, message: String(error?.message ?? error) });
    }
  };
}

function circleWorkerSource() {
  return `${createCircleSearch.toString()}\n(${runCircleWorker.toString()})(createCircleSearch());\n`;
}
