const catalogUrl = "/gameforgejs/demos/demos.json";
const catalog = document.querySelector("#demo-catalog");
const status = document.querySelector("#catalog-status");

function createText(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  return element;
}

function addDemo(demo) {
  const card = document.createElement("article");
  card.className = "demo-catalog-card";
  if (demo.screenshot) {
    const image = document.createElement("img");
    const extension = demo.screenshotExtension === "png" ? "png" : "jpg";
    image.src = `/gameforgejs/assets/demos/${demo.id}.${extension}`;
    image.alt = `${demo.name} gameplay capture`;
    image.loading = "lazy";
    card.append(image);
  }
  const copy = document.createElement("div");
  copy.className = "demo-catalog-copy";
  copy.append(createText("p", "card-kicker", `${demo.dimension.toUpperCase()} · ${demo.id}`));
  copy.append(createText("h3", "", demo.name));
  copy.append(createText("p", "", demo.description || "A refreshed build is being verified before its details are published."));
  const state = createText("span", `demo-state ${demo.playable ? "playable" : "unavailable"}`, demo.statusLabel);
  copy.append(state);
  const link = createText("a", "text-link", "Open demo route");
  link.href = `/gameforgejs/demos/${demo.id}/`;
  copy.append(link);
  if (demo.playable) {
    const play = createText("a", "text-link", "Play now");
    play.href = `/gameforgejs/demos/${demo.id}/play/`;
    copy.append(play);
  }
  card.append(copy);
  catalog.append(card);
}

fetch(catalogUrl)
  .then(response => {
    if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
    return response.json();
  })
  .then(data => {
    if (!Array.isArray(data.demos) || data.demos.length !== 20) {
      throw new Error("The current demo catalog does not contain exactly 20 entries.");
    }
    data.demos.forEach(addDemo);
    status.textContent = `${data.demos.length} official demo IDs · ${data.demos.filter(demo => demo.playable).length} playable routes · 1 backend-required route.`;
  })
  .catch(error => {
    status.textContent = `Unable to load demos: ${error.message}`;
  });
