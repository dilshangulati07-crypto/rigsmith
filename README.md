# Rigsmith

A 3D PC building web app: pick parts with a live compatibility check, build the PC by hand in 3D (place every part, route every cable), or press Auto-build and watch it assemble itself. Plain HTML, CSS and JavaScript (ES modules) with Three.js vendored in `vendor/`, no build step.

## Run it

```
node tools/serve.mjs        # http://localhost:8000
```

Any static server works; this one sends `Cache-Control: no-store` so module changes show up on reload.

## Tests

Node tests (fast):

```
node tools/validate-data.mjs
node tools/test-compat.mjs
node tools/test-layout.mjs
node tools/test-assembly.mjs
node tools/test-cables.mjs
node tools/test-autobuild.mjs
node tools/test-cinematic.mjs
node tools/test-presets.mjs
node tools/test-share.mjs
```

Browser tests run in headless Chrome (set `CHROME=<path>` if it is not found). Add `-v` to print passing checks and `--shots <dir>` to save screenshots:

```
node tools/test-browser.mjs
node tools/test-realism-browser.mjs
node tools/test-share-browser.mjs
node tools/test-cinematic-browser.mjs
```

Note: the browser tests use Chrome's software renderer (SwiftShader) so results match on every machine, which makes them slow. `test-browser` takes over 10 minutes, and `test-cinematic-browser` plays four full Auto-build sequences at about 11x slower than real time, so expect 20 minutes or more. Run it on its own, and stop it if it prints nothing for much longer than that.

After changing CSS or JS, run `node tools/stamp-version.mjs` (`--check` verifies) before committing.
