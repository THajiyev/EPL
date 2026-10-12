const CircleSnapshot = (() => {
  const { clubFor } = CircleTeams;
  const { ringLayout } = CircleRing;
  const { teamName, winnerScore } = CircleFormat;

  const WIDTH = 1080;
  const PADDING = 64;
  const HEADER_HEIGHT = 216;
  const ROW_HEIGHT = 48;
  const FOOTER_HEIGHT = 112;
  const SANS = '"Archivo", "Helvetica Neue", Arial, sans-serif';
  const MONO = '"IBM Plex Mono", ui-monospace, Consolas, monospace';
  const IMAGE_TIMEOUT_MS = 8000;

  function themeColors() {
    const styles = getComputedStyle(document.documentElement);
    const read = (name) => styles.getPropertyValue(name).trim();
    return {
      paper: read("--paper"),
      ink: read("--ink"),
      muted: read("--muted"),
      rule: read("--rule"),
      brand: read("--brand"),
      disc: read("--disc"),
    };
  }

  function loadImage(url) {
    return new Promise((resolve) => {
      const image = new Image();
      const timer = setTimeout(() => resolve(null), IMAGE_TIMEOUT_MS);
      image.crossOrigin = "anonymous";
      image.onload = () => {
        clearTimeout(timer);
        resolve(image);
      };
      image.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      image.src = url;
    });
  }

  async function loadCrestImages(slugs, crestUrls) {
    const entries = await Promise.all(
      slugs.map(async (slug) => [slug, crestUrls.has(slug) ? await loadImage(crestUrls.get(slug)) : null]),
    );
    return new Map(entries);
  }

  function text(context, value, x, y, { font, color, align = "left", baseline = "alphabetic" }) {
    context.font = font;
    context.fillStyle = color;
    context.textAlign = align;
    context.textBaseline = baseline;
    context.fillText(value, x, y);
  }

  function drawHeader(context, colors, details) {
    context.fillStyle = colors.brand;
    context.fillRect(0, 0, WIDTH, 16);
    text(context, "Circle of Victory", PADDING, 104, { font: `800 64px ${SANS}`, color: colors.ink });
    text(context, details.subtitle, PADDING, 152, { font: `500 26px ${MONO}`, color: colors.muted });
    context.fillStyle = colors.ink;
    context.fillRect(PADDING, HEADER_HEIGHT - 24, WIDTH - PADDING * 2, 3);
  }

  function drawArrowhead(context, x, y, angle, length, color) {
    const direction = angle + Math.PI / 2;
    const tipX = x + Math.cos(direction) * length * 0.3;
    const tipY = y + Math.sin(direction) * length * 0.3;
    const backX = tipX - Math.cos(direction) * length;
    const backY = tipY - Math.sin(direction) * length;
    const spreadX = Math.cos(direction + Math.PI / 2) * length * 0.5;
    const spreadY = Math.sin(direction + Math.PI / 2) * length * 0.5;
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(tipX, tipY);
    context.lineTo(backX + spreadX, backY + spreadY);
    context.lineTo(backX - spreadX, backY - spreadY);
    context.closePath();
    context.fill();
  }

  function drawEdges(context, layout, colors, scale) {
    const width = 5 * scale;
    context.strokeStyle = colors.brand;
    context.lineWidth = width;
    for (const edge of layout.edges) {
      context.beginPath();
      context.arc(layout.center, layout.center, edge.arrowRadius, edge.from, edge.to);
      context.stroke();
      const endX = layout.center + edge.arrowRadius * Math.cos(edge.to);
      const endY = layout.center + edge.arrowRadius * Math.sin(edge.to);
      drawArrowhead(context, endX, endY, edge.to, width * 5, colors.brand);
    }
  }

  function drawInitials(context, club, radius) {
    context.fillStyle = club.color;
    context.beginPath();
    context.arc(0, 0, radius * 0.88, 0, Math.PI * 2);
    context.fill();
    text(context, club.code, 0, 0, { font: `800 ${radius * 0.52}px ${SANS}`, color: club.ink, align: "center", baseline: "middle" });
  }

  function drawCrest(context, image, radius) {
    const box = radius * 1.5;
    const fit = Math.min(box / image.naturalWidth, box / image.naturalHeight);
    const width = image.naturalWidth * fit;
    const height = image.naturalHeight * fit;
    context.drawImage(image, -width / 2, -height / 2, width, height);
  }

  function drawNode(context, layout, node, slug, image, colors) {
    const radius = layout.nodeRadius;
    context.save();
    context.translate(node.x, node.y);
    context.fillStyle = colors.disc;
    context.strokeStyle = colors.rule;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    if (image) drawCrest(context, image, radius);
    else drawInitials(context, clubFor(slug), radius);
    const labelX = layout.labelOffset * Math.cos(node.angle);
    const labelY = layout.labelOffset * Math.sin(node.angle);
    text(context, clubFor(slug).code, labelX, labelY, { font: `500 ${layout.labelSize}px ${MONO}`, color: colors.muted, align: "center", baseline: "middle" });
    context.restore();
  }

  function drawRing(context, circle, images, colors, top) {
    const layout = ringLayout(circle.slugs.length);
    const scale = WIDTH / layout.size;
    context.save();
    context.translate(0, top);
    context.scale(scale, scale);
    context.strokeStyle = colors.rule;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(layout.center, layout.center, layout.ringRadius, 0, Math.PI * 2);
    context.stroke();
    drawEdges(context, layout, colors, 1);
    layout.nodes.forEach((node, index) => drawNode(context, layout, node, circle.slugs[index], images.get(circle.slugs[index]), colors));
    context.restore();
  }

  function drawResults(context, circle, colors, top) {
    const columns = { index: PADDING, winner: PADDING + 56, score: PADDING + 360, loser: PADDING + 640 };
    text(context, "RESULTS BEHIND EACH ARROW", PADDING, top, { font: `400 22px ${MONO}`, color: colors.muted });
    context.fillStyle = colors.ink;
    context.fillRect(PADDING, top + 16, WIDTH - PADDING * 2, 3);
    circle.edges.forEach((edge, index) => {
      const baseline = top + 16 + ROW_HEIGHT * (index + 1) - 14;
      text(context, String(index + 1), columns.index, baseline, { font: `400 24px ${MONO}`, color: colors.muted });
      text(context, teamName(edge.from), columns.winner, baseline, { font: `600 28px ${SANS}`, color: colors.ink });
      const scores = edge.matches.map((match) => winnerScore(match, edge.from)).join(", ");
      text(context, scores, columns.score, baseline, { font: `400 24px ${MONO}`, color: colors.ink });
      text(context, teamName(edge.to), columns.loser, baseline, { font: `400 28px ${SANS}`, color: colors.ink });
      context.fillStyle = colors.rule;
      context.fillRect(PADDING, top + 16 + ROW_HEIGHT * (index + 1), WIDTH - PADDING * 2, 1);
    });
  }

  function drawFooter(context, colors, top, details) {
    text(context, details.footer, PADDING, top + 56, { font: `400 22px ${MONO}`, color: colors.muted });
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create the image."))), "image/png");
    });
  }

  async function renderCircleImage(circle, crestUrls, details) {
    await document.fonts?.ready;
    const images = await loadCrestImages(circle.slugs, crestUrls);
    const resultsTop = HEADER_HEIGHT + WIDTH + 24;
    const height = resultsTop + 16 + ROW_HEIGHT * circle.edges.length + FOOTER_HEIGHT;
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const colors = themeColors();
    context.fillStyle = colors.paper;
    context.fillRect(0, 0, WIDTH, height);
    drawHeader(context, colors, details);
    drawRing(context, circle, images, colors, HEADER_HEIGHT);
    drawResults(context, circle, colors, resultsTop);
    drawFooter(context, colors, resultsTop + 16 + ROW_HEIGHT * circle.edges.length, details);
    return canvasToBlob(canvas);
  }

  return { renderCircleImage };
})();
