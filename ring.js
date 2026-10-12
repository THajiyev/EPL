const CircleRing = (() => {
  const { clubFor } = CircleTeams;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const VIEW_SIZE = 1000;
  const CENTER = VIEW_SIZE / 2;
  const RING_RADIUS = 352;
  const BASE_NODE_RADIUS = 50;
  const ANIMATION_MS = 650;
  const TOP_ANGLE = -Math.PI / 2;

  function svgElement(name, attributes = {}, parent = null) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (parent) parent.appendChild(element);
    return element;
  }

  function polar(radius, angle) {
    return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
  }

  function nodeRadiusFor(count) {
    const chord = 2 * RING_RADIUS * Math.sin(Math.PI / Math.max(count, 3));
    return Math.min(78, Math.max(26, chord * 0.4));
  }

  function angleFor(index, count) {
    return TOP_ANGLE + (2 * Math.PI * index) / count;
  }

  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  }

  function shortestTurn(from, to) {
    const turn = (to - from) % (2 * Math.PI);
    if (turn > Math.PI) return turn - 2 * Math.PI;
    if (turn < -Math.PI) return turn + 2 * Math.PI;
    return turn;
  }

  function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  function buildDefs(svg) {
    const defs = svgElement("defs", {}, svg);
    const marker = svgElement(
      "marker",
      { id: "arrowhead", viewBox: "0 0 10 10", refX: "7", refY: "5", markerWidth: "5", markerHeight: "5", orient: "auto-start-reverse" },
      defs,
    );
    svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "arrowhead" }, marker);
  }

  function buildNode(slug, layer) {
    const club = clubFor(slug);
    const group = svgElement("g", { class: "node", "data-slug": slug }, layer);
    svgElement("title", {}, group).textContent = club.name;
    svgElement("circle", { class: "node-disc", r: String(BASE_NODE_RADIUS) }, group);
    const badge = svgElement("g", { class: "node-badge" }, group);
    svgElement("circle", { r: String(BASE_NODE_RADIUS - 6), fill: club.color }, badge);
    const initials = svgElement("text", { class: "node-initials", fill: club.ink, "text-anchor": "middle", "dominant-baseline": "central" }, badge);
    initials.textContent = club.code;
    const size = BASE_NODE_RADIUS * 1.5;
    svgElement(
      "image",
      { class: "node-crest", x: String(-size / 2), y: String(-size / 2), width: String(size), height: String(size), preserveAspectRatio: "xMidYMid meet" },
      group,
    );
    const label = svgElement("text", { class: "node-label", "text-anchor": "middle", "dominant-baseline": "central" }, group);
    label.textContent = club.code;
    return group;
  }

  function arcPath(radius, fromAngle, toAngle) {
    const start = polar(radius, fromAngle);
    const end = polar(radius, toAngle);
    const largeArc = toAngle - fromAngle > Math.PI ? 1 : 0;
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }

  function edgeGeometry(index, count) {
    const nodeRadius = nodeRadiusFor(count);
    const arrowRadius = RING_RADIUS - nodeRadius - 22;
    const step = (2 * Math.PI) / count;
    const trim = Math.min(step * 0.18, Math.asin(Math.min(1, (nodeRadius * 0.35) / arrowRadius)));
    const from = angleFor(index, count) + trim;
    const to = angleFor(index, count) + step - trim;
    return { arrowRadius, from, to };
  }

  function placeLabel(label, angle, nodeRadius) {
    const scale = nodeRadius / BASE_NODE_RADIUS;
    const offset = BASE_NODE_RADIUS + 26 / scale;
    label.setAttribute("x", (offset * Math.cos(angle)).toFixed(2));
    label.setAttribute("y", (offset * Math.sin(angle)).toFixed(2));
    label.setAttribute("font-size", (Math.max(20, nodeRadius * 0.42) / scale).toFixed(2));
  }

  function ringLayout(count) {
    const nodeRadius = nodeRadiusFor(count);
    const nodes = Array.from({ length: count }, (_, index) => {
      const angle = angleFor(index, count);
      return { angle, ...polar(RING_RADIUS, angle) };
    });
    return {
      size: VIEW_SIZE,
      center: CENTER,
      ringRadius: RING_RADIUS,
      nodeRadius,
      labelOffset: nodeRadius + 26,
      labelSize: Math.max(20, nodeRadius * 0.42),
      nodes,
      edges: nodes.map((_, index) => edgeGeometry(index, count)),
    };
  }

  function applyCrest(element, url) {
    const image = element.querySelector(".node-crest");
    if (image.getAttribute("href") === url) return;
    image.setAttribute("href", url);
    element.classList.add("has-crest");
  }

  function createRing(svg, handlers) {
    svg.setAttribute("viewBox", `0 0 ${VIEW_SIZE} ${VIEW_SIZE}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    buildDefs(svg);
    svgElement("circle", { class: "ring-guide", cx: String(CENTER), cy: String(CENTER), r: String(RING_RADIUS) }, svg);
    const edgeLayer = svgElement("g", { class: "edges" }, svg);
    const nodeLayer = svgElement("g", { class: "nodes" }, svg);
    const nodes = new Map();
    const crests = new Map();
    let frame = 0;

    function drawNode(node) {
      const { x, y } = polar(RING_RADIUS, node.angle);
      const scale = node.size / BASE_NODE_RADIUS;
      node.element.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})`);
      node.element.style.opacity = node.opacity.toFixed(3);
      placeLabel(node.label, node.angle, node.size);
    }

    function ensureNode(slug, angle) {
      if (!nodes.has(slug)) {
        const element = buildNode(slug, nodeLayer);
        nodes.set(slug, { slug, element, label: element.querySelector(".node-label"), angle, size: 0, opacity: 0 });
        if (crests.has(slug)) applyCrest(element, crests.get(slug));
      }
      return nodes.get(slug);
    }

    function planMoves(slugs) {
      const count = slugs.length;
      const size = nodeRadiusFor(count);
      const targets = new Map(slugs.map((slug, index) => [slug, { angle: angleFor(index, count), size, opacity: 1 }]));
      const moves = [];
      for (const [slug, target] of targets) {
        const node = ensureNode(slug, target.angle);
        moves.push({ node, from: { angle: node.angle, size: node.size, opacity: node.opacity }, to: target });
      }
      for (const node of nodes.values()) {
        if (!targets.has(node.slug)) moves.push({ node, from: { ...node }, to: { angle: node.angle, size: node.size * 0.4, opacity: 0 }, leaving: true });
      }
      return moves;
    }

    function applyStep(moves, progress) {
      for (const { node, from, to } of moves) {
        node.angle = from.angle + shortestTurn(from.angle, to.angle) * progress;
        node.size = from.size + (to.size - from.size) * progress;
        node.opacity = from.opacity + (to.opacity - from.opacity) * progress;
        drawNode(node);
      }
    }

    function finishMoves(moves) {
      for (const move of moves) {
        if (move.leaving) {
          move.node.element.remove();
          nodes.delete(move.node.slug);
        }
      }
    }

    function animate(moves) {
      cancelAnimationFrame(frame);
      const duration = prefersReducedMotion() ? 0 : ANIMATION_MS;
      const startedAt = performance.now();
      const tick = (now) => {
        const linear = duration === 0 ? 1 : Math.min(1, (now - startedAt) / duration);
        applyStep(moves, easeInOut(linear));
        if (linear < 1) frame = requestAnimationFrame(tick);
        else finishMoves(moves);
      };
      frame = requestAnimationFrame(tick);
    }

    function drawEdges(count) {
      edgeLayer.replaceChildren();
      edgeLayer.classList.remove("edges-enter");
      void edgeLayer.getBoundingClientRect();
      edgeLayer.classList.add("edges-enter");
      for (let index = 0; index < count; index++) {
        const { arrowRadius, from, to } = edgeGeometry(index, count);
        const group = svgElement("g", { class: "edge", "data-index": String(index), tabindex: "0", role: "button" }, edgeLayer);
        const d = arcPath(arrowRadius, from, to);
        svgElement("path", { class: "edge-line", d, "marker-end": "url(#arrowhead)" }, group);
        svgElement("path", { class: "edge-hit", d }, group);
        group.addEventListener("pointerenter", (event) => handlers.onEdgeEnter(index, event));
        group.addEventListener("pointerleave", () => handlers.onEdgeLeave(index));
        group.addEventListener("click", (event) => handlers.onEdgeTap(index, event));
        group.addEventListener("focus", (event) => handlers.onEdgeEnter(index, event));
        group.addEventListener("blur", () => handlers.onEdgeLeave(index));
      }
    }

    function show(slugs) {
      animate(planMoves(slugs));
      drawEdges(slugs.length);
    }

    function clear() {
      animate(planMoves([]));
      edgeLayer.replaceChildren();
    }

    function setCrest(slug, url) {
      crests.set(slug, url);
      const node = nodes.get(slug);
      if (node) applyCrest(node.element, url);
    }

    return { show, clear, setCrest };
  }

  return { createRing, ringLayout };
})();
