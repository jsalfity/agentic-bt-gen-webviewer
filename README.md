# Agentic BT Gen Webviewer

A local-first project webpage for browsing PyRoboSim experiment results, inspecting generated behavior trees, and optionally running a selected BT against a live `pyrobosim.sim_app` server.

## Design

| Layer | Purpose |
|---|---|
| Static catalog | Stores batch summaries, task prompts, normalized task specs, generated BTs, and result rows in `public/data/catalog.json`. This is the part that can later be deployed to GitHub Pages. |
| Frontend | Renders the project page, task browser, batch metrics, BT viewer, and runtime panel from the static catalog. |
| Local runtime adapter | Proxies BT execution, status polling, world-state polling, reset, and live frame image requests to a running `pyrobosim.sim_app` instance. This is only needed for local interactive runs. |
| Data snapshots | Keeps a local copy of the currently selected experiment artifacts under `data_snapshots/` so the webviewer does not depend on `bt-eval-harness` to browse data. |

## Files

| Path | Role |
|---|---|
| `build_catalog.py` | Builds the static catalog from the local `data_snapshots/` copies of generated batches and task specs. |
| `server.py` | Serves the frontend and exposes `/api/runtime/*` endpoints for local sim interaction. |
| `data_snapshots/generated/` | Local copies of the batch result directories used by the viewer. |
| `data_snapshots/task_specs/` | Local copies of the PyRoboSim task-spec YAML files used for readable task rendering. |
| `public/index.html` | Project webpage shell. |
| `public/styles.css` | Site styling. |
| `public/app.js` | Frontend data loading, filtering, rendering, and runtime polling. |
| `public/data/catalog.json` | Generated static dataset for the site. |

## Local Run

1. Rebuild the catalog from the local snapshots:

```bash
cd /Users/jonathansalfity/Documents/dev/bt-workspace-claude/agentic-bt-gen-webviewer
python3 build_catalog.py
```

2. Start the PyRoboSim sim app in a separate terminal:

```bash
cd /Users/jonathansalfity/Documents/dev/bt-workspace-claude/pyrobosim/pyrobosim
python3 -m pyrobosim.sim_app.server --world-file roscon_2024_workshop_world.yaml --port 8080
```

3. Start the local webviewer server:

```bash
cd /Users/jonathansalfity/Documents/dev/bt-workspace-claude/agentic-bt-gen-webviewer
python3 server.py --port 8123
```

4. Open [http://127.0.0.1:8123](http://127.0.0.1:8123).

## Notes

| Topic | Detail |
|---|---|
| Current scope | Focused on the copied PyRoboSim `core60` and `language50` M-Core snapshots currently stored under `data_snapshots/generated`. |
| Runtime dependency | The page remains browseable without a running sim app; only the live execution controls are disabled. |
| Deployment split | GitHub Pages can host the static frontend and `catalog.json`. Heroku or another app host can run the Python adapter if remote runtime control is needed later. |
| PyRoboSim packaging | The browser should not be responsible for downloading and running PyRoboSim itself. The correct split is: static site in the browser, Python sim server as a separate backend service or local process. |
