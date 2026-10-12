function runCircleWorker(search) {
  function reportProgress(phase, fraction) {
    self.postMessage({ type: "progress", phase, fraction });
  }

  self.onmessage = (event) => {
    const { requestId, beats } = event.data;
    try {
      const adjacency = Uint32Array.from(beats);
      const result = search.findLongestCycles(adjacency, { limit: search.CYCLE_CAP, onProgress: reportProgress });
      const cycles = result.cycles.filter((cycle) => search.isValidCycle(cycle, adjacency));
      self.postMessage({ type: "result", requestId, longest: result.longest, cycles, capped: result.capped });
    } catch (error) {
      self.postMessage({ type: "error", requestId, message: String(error?.message ?? error) });
    }
  };
}

function circleWorkerSource() {
  return `${createCircleSearch.toString()}\n(${runCircleWorker.toString()})(createCircleSearch());\n`;
}
