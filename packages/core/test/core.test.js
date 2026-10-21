import assert from "node:assert/strict";
import { test } from "node:test";
import { CITIES, nearestCity } from "../src/cities.js";
import { isLand } from "../src/land.js";
import { createScene } from "../src/scene.js";
import { decodeTheme, encodeTheme, parseColorsToml, THEME_KEYS } from "../src/theme.js";
import { THEMES } from "../src/themes.js";

test("land mask matches known places", () => {
  for (const [lat, lon] of [[52.5, 13.4], [-15, -50], [40, -100], [-25, 135], [-80, 0], [0, 20]]) assert.ok(isLand(lat, lon), `${lat},${lon}`);
  for (const [lat, lon] of [[30, -40], [0, -150], [-40, 80], [35, 18]]) assert.ok(!isLand(lat, lon), `${lat},${lon}`);
});

test("city ids are unique and snapping picks the nearest", () => {
  assert.equal(new Set(CITIES.map((c) => c.id)).size, CITIES.length);
  assert.equal(nearestCity(52.4, 13.1).id, "berlin-de");
  assert.equal(nearestCity(-33.9, 151.0).id, "sydney-au");
  assert.equal(nearestCity(52.2, 0.13).id, "cambridge-gb");
  assert.equal(nearestCity(51.5, -0.1).id, "london-gb");
});

test("projection puts the facing point at the globe center", () => {
  const scene = createScene();
  scene.resize(320, 200);
  const { lat, lon } = scene.rotation;
  const p = scene.project(lat, lon);
  assert.ok(Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9 && Math.abs(p.z - 1) < 1e-9);
});

test("scene renders frames and survives heat, pulses and drags", () => {
  const scene = createScene({ random: () => 0.5 });
  scene.resize(320, 200);
  scene.setHeat(CITIES.slice(0, 40).map((c, i) => [c.id, i + 1]));
  scene.setHeat([{ id: "nowhere", count: 3 }, { id: "berlin-de", count: 5 }]);
  scene.pulse("berlin-de");
  scene.rotateBy(30, -10);
  let px;
  for (let i = 0; i < 120; i++) px = scene.tick(1 / 60);
  assert.equal(px.length, 320 * 200 * 4);
  assert.ok(px.some((v, i) => i % 4 === 3 && v === 255));
});

test("colors.toml parsing", () => {
  const t = parseColorsToml('mode = "dark"\naccent = "#7AA2F7"\n# c = "#000000"\n');
  assert.deepEqual(t, { accent: "#7aa2f7" });
});

test("zoom keeps the point under the cursor and pick finds meetups", () => {
  const scene = createScene({ autoRotate: false, random: () => 0.5 });
  scene.resize(400, 240);
  scene.tick(0);
  const sx = 230;
  const sy = 150;
  const before = scene.unproject(sx, sy);
  scene.zoomAt(3, sx, sy);
  for (let i = 0; i < 90; i++) scene.tick(1 / 60);
  assert.ok(Math.abs(scene.zoom - 3) < 0.01);
  const after = scene.project(before.lat, before.lon);
  assert.ok(Math.hypot(after.sx - sx, after.sy - sy) < 0.5, `drifted to ${after.sx},${after.sy}`);

  scene.setMarkers([{ id: "m1", lat: before.lat, lon: before.lon, upcoming: true, label: "Praha" }]);
  scene.tick(1 / 60);
  assert.deepEqual(scene.pick(sx, sy), ["m1"]);
  assert.deepEqual(scene.pick(sx + 40, sy), []);

  scene.flyTo(-33.87, 151.21, 4);
  for (let i = 0; i < 400; i++) scene.tick(1 / 60);
  const sydney = scene.project(-33.87, 151.21);
  assert.ok(Math.abs(sydney.x) < 1e-6 && Math.abs(sydney.y) < 1e-6 && scene.zoom === 4);
});

test("themes round-trip through the compact link encoding", () => {
  assert.equal(Object.keys(THEMES).length >= 20, true);
  for (const [name, theme] of Object.entries(THEMES)) {
    assert.deepEqual(Object.keys(theme), [...THEME_KEYS], name);
    assert.deepEqual(decodeTheme(encodeTheme(theme)), theme, name);
  }
  assert.equal(encodeTheme(THEMES.nord).length, THEME_KEYS.length * 6);
  assert.deepEqual(decodeTheme("81a1c1"), { background: "#81a1c1" }, "older, shorter links still decode");
  for (const bad of ["", "zzzzzz", "12345", "a".repeat(THEME_KEYS.length * 6 + 6), null]) assert.equal(decodeTheme(bad), null);
});

test("setView places the camera at once", () => {
  const scene = createScene({ autoRotate: false });
  scene.resize(320, 200);
  scene.setView(35.68, 139.69, 3);
  scene.tick(1 / 60);
  const tokyo = scene.project(35.68, 139.69);
  assert.ok(Math.abs(tokyo.x) < 1e-9 && Math.abs(tokyo.y) < 1e-9);
  assert.equal(scene.zoom, 3);
});

test("quiet cities can be picked, and waves float a sprite up from them", () => {
  const scene = createScene({ autoRotate: false, random: () => 0.5 });
  scene.resize(400, 240);
  scene.setView(59.91, 10.75, 3);
  scene.setHeat([["berlin-de", 5]]);
  scene.setToday(["oslo-no", "berlin-de", "nowhere"]);
  scene.tick(1 / 60);
  const oslo = scene.project(59.91, 10.75);
  assert.equal(scene.pickCity(oslo.sx + 2, oslo.sy), "oslo-no");
  assert.equal(scene.pickCity(oslo.sx + 30, oslo.sy + 30), null);

  const red = { width: 2, height: 2, data: new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 255, 0, 0, 255]) };
  scene.setSprites({ wave: red });
  scene.wave("oslo-no", "wave");
  let px;
  for (let i = 0; i < 20; i++) px = scene.tick(1 / 60);
  const isRed = (i) => px[i] === 255 && px[i + 1] === 0 && px[i + 2] === 0;
  assert.ok(px.some((_, i) => i % 4 === 0 && isRed(i)), "the sprite is drawn");
  for (let i = 0; i < 200; i++) px = scene.tick(1 / 60);
  assert.ok(!px.some((_, i) => i % 4 === 0 && isRed(i)), "and gone once it has floated away");
});
