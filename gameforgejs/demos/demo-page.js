const demoId = window.location.pathname.split("/").filter(Boolean).pop();

fetch("/gameforgejs/demos/demos.json")
  .then(response => {
    if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
    return response.json();
  })
  .then(data => {
    const demo = data.demos.find(item => item.id === demoId);
    if (!demo) throw new Error("This demo ID is not in the current official catalog.");
    document.title = `${demo.name} · GameForgeJS Demos`;
    document.querySelector("#demo-breadcrumb").textContent = demo.name;
    document.querySelector("#demo-title").textContent = demo.name;
    document.querySelector("#demo-dimension").textContent = `${demo.dimension.toUpperCase()} · ${demo.id}`;
    document.querySelector("#demo-description").textContent = demo.description;
    document.querySelector("#demo-controls").textContent = demo.controls || "Controls are not published until the current build has been verified.";
    const state = document.querySelector("#demo-state");
    state.textContent = demo.statusLabel;
    state.classList.add(demo.playable ? "playable" : "unavailable");
    if (demo.screenshot) {
      const image = document.querySelector("#demo-image");
      image.src = `/gameforgejs/assets/demos/${demo.id}.jpg`;
      image.alt = `${demo.name} gameplay capture`;
      document.querySelector("#demo-image-wrap").hidden = false;
    }
    if (demo.playable) {
      const frame = document.querySelector("#game-frame");
      frame.querySelector("iframe").src = "play/";
      frame.hidden = false;
    } else {
      const message = document.querySelector("#demo-unavailable");
      message.textContent = demo.unavailableMessage;
      message.hidden = false;
    }
  })
  .catch(error => {
    document.querySelector("#demo-title").textContent = "Demo unavailable";
    document.querySelector("#demo-description").textContent = error.message;
    document.querySelector("#demo-state").textContent = "Catalog error";
  });
